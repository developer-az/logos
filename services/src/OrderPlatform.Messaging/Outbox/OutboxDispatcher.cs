using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace OrderPlatform.Messaging.Outbox;

/// <summary>
/// Publishes committed outbox rows to Kafka in insertion order (at-least-once).
/// On PostgreSQL rows are claimed with FOR UPDATE SKIP LOCKED so several replicas can run it safely.
/// </summary>
public sealed class OutboxDispatcher<TDbContext>(
    IServiceScopeFactory scopes,
    IMessageProducer producer,
    IOptions<KafkaOptions> options,
    TimeProvider clock,
    ILogger<OutboxDispatcher<TDbContext>> logger) : BackgroundService
    where TDbContext : DbContext, IMessagingDbContext
{
    private const string NpgsqlProvider = "Npgsql.EntityFrameworkCore.PostgreSQL";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var opts = options.Value;
        if (!opts.Enabled) return;

        while (!stoppingToken.IsCancellationRequested)
        {
            var published = 0;
            try
            {
                published = await DispatchPendingAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Outbox dispatch failed; retrying after {Interval}", opts.OutboxPollInterval);
            }

            // A full batch means there is probably more waiting, so go again immediately.
            if (published < opts.OutboxBatchSize)
                await Task.Delay(opts.OutboxPollInterval, clock, stoppingToken).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
        }
    }

    /// <summary>Publishes one batch and returns how many rows were published.</summary>
    public async Task<int> DispatchPendingAsync(CancellationToken ct)
    {
        var batchSize = options.Value.OutboxBatchSize;
        await using var scope = scopes.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<TDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync(ct);

        var batch = db.Database.ProviderName == NpgsqlProvider
            ? await db.OutboxMessages
                .FromSql($"SELECT * FROM outbox_messages WHERE published_at IS NULL ORDER BY id LIMIT {batchSize} FOR UPDATE SKIP LOCKED")
                .ToListAsync(ct)
            : await db.OutboxMessages.Where(x => x.PublishedAt == null).OrderBy(x => x.Id).Take(batchSize).ToListAsync(ct);

        var published = 0;
        foreach (var message in batch)
        {
            try
            {
                await producer.ProduceAsync(new OutgoingMessage(message.Topic, message.Key, message.Body, new Dictionary<string, string>
                {
                    ["event-id"] = message.EventId.ToString(),
                    ["event-type"] = message.EventType,
                }), ct);
                message.PublishedAt = clock.GetUtcNow();
                published++;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                message.Attempts++;
                message.LastError = Truncate(ex.Message, 2000);
                logger.LogWarning(ex, "Publishing outbox message {Id} ({EventType}) failed on attempt {Attempts}",
                    message.Id, message.EventType, message.Attempts);
                // Stop here so later events for the same key are never published ahead of this one.
                break;
            }
        }

        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return published;
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
