using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using OrderPlatform.Messaging.Kafka;
using OrderPlatform.Messaging.Outbox;

namespace OrderPlatform.Messaging;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddKafkaMessaging(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<KafkaOptions>(configuration.GetSection(KafkaOptions.Section));
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IMessageProducer, KafkaMessageProducer>();
        services.TryAddSingleton<MessageProcessor>();
        services.AddHostedService<KafkaTopicProvisioner>();
        return services;
    }

    public static IServiceCollection AddOutboxDispatcher<TDbContext>(this IServiceCollection services)
        where TDbContext : DbContext, IMessagingDbContext
    {
        services.TryAddSingleton<OutboxDispatcher<TDbContext>>();
        services.AddHostedService(sp => sp.GetRequiredService<OutboxDispatcher<TDbContext>>());
        return services;
    }

    public static IServiceCollection AddKafkaConsumer<THandler>(this IServiceCollection services, params string[] topics)
        where THandler : class, IMessageHandler
    {
        services.TryAddScoped<THandler>();
        services.AddHostedService(sp => new KafkaConsumerWorker<THandler>(
            topics,
            sp.GetRequiredService<MessageProcessor>(),
            sp.GetRequiredService<IOptions<KafkaOptions>>(),
            sp.GetRequiredService<ILogger<KafkaConsumerWorker<THandler>>>()));
        return services;
    }
}
