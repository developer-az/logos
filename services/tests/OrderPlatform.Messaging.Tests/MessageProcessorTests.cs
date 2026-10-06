using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using OrderPlatform.Contracts;

namespace OrderPlatform.Messaging.Tests;

public class MessageProcessorTests
{
    private sealed class CountingHandler(Counter counter) : IMessageHandler
    {
        public Task HandleAsync(EventEnvelope envelope, CancellationToken ct)
        {
            counter.Calls++;
            if (counter.Calls <= counter.FailuresBeforeSuccess) throw new TimeoutException($"transient #{counter.Calls}");
            counter.Seen.Add(envelope.EventId);
            return Task.CompletedTask;
        }
    }

    private sealed class Counter
    {
        public int Calls;
        public int FailuresBeforeSuccess;
        public List<Guid> Seen { get; } = [];
    }

    private readonly FakeProducer _producer = new();
    private readonly Counter _counter = new();

    private MessageProcessor CreateProcessor(int maxAttempts = 3)
    {
        var services = new ServiceCollection().AddSingleton(_counter).AddScoped<CountingHandler>().BuildServiceProvider();
        return new MessageProcessor(services.GetRequiredService<IServiceScopeFactory>(), _producer,
            Options.Create(new KafkaOptions { MaxHandlerAttempts = maxAttempts, InitialRetryDelay = TimeSpan.Zero }),
            TimeProvider.System, NullLogger<MessageProcessor>.Instance);
    }

    private static IncomingMessage Message(string? body = null) => new(Topics.OrderEvents, "k",
        body ?? EventEnvelope.Create(new OrderConfirmed(Guid.NewGuid()), Guid.NewGuid()).Serialize(), Partition: 2, Offset: 42);

    [Fact]
    public async Task Handles_a_message_on_the_first_attempt()
    {
        var outcome = await CreateProcessor().ProcessAsync<CountingHandler>(Message(), default);

        Assert.Equal(ProcessingOutcome.Handled, outcome);
        Assert.Equal(1, _counter.Calls);
        Assert.Empty(_producer.Produced);
    }

    [Fact]
    public async Task Retries_transient_failures_until_the_handler_succeeds()
    {
        _counter.FailuresBeforeSuccess = 2;

        var outcome = await CreateProcessor(maxAttempts: 3).ProcessAsync<CountingHandler>(Message(), default);

        Assert.Equal(ProcessingOutcome.Handled, outcome);
        Assert.Equal(3, _counter.Calls);
        Assert.Single(_counter.Seen);
    }

    [Fact]
    public async Task Dead_letters_after_the_last_attempt_with_its_origin()
    {
        _counter.FailuresBeforeSuccess = int.MaxValue;
        var message = Message();

        var outcome = await CreateProcessor(maxAttempts: 3).ProcessAsync<CountingHandler>(message, default);

        Assert.Equal(ProcessingOutcome.DeadLettered, outcome);
        Assert.Equal(3, _counter.Calls);
        var dlt = Assert.Single(_producer.Produced);
        Assert.Equal("orders.events.v1.dlt", dlt.Topic);
        Assert.Equal(message.Body, dlt.Body);
        Assert.Equal("42", dlt.Headers["dlt-source-offset"]);
        Assert.Equal("3", dlt.Headers["dlt-attempts"]);
        Assert.Contains("TimeoutException", dlt.Headers["dlt-error"]);
    }

    [Fact]
    public async Task Dead_letters_unreadable_messages_without_calling_the_handler()
    {
        var outcome = await CreateProcessor().ProcessAsync<CountingHandler>(Message("{oops"), default);

        Assert.Equal(ProcessingOutcome.DeadLettered, outcome);
        Assert.Equal(0, _counter.Calls);
        Assert.Equal("0", Assert.Single(_producer.Produced).Headers["dlt-attempts"]);
    }
}
