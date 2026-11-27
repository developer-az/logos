global using Xunit;
using System.Net;
using System.Net.Sockets;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using Finance.Service;
using Inventory.Service;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Order.Service;
using Procurement.Service;
using Testcontainers.PostgreSql;

namespace OrderPlatform.IntegrationTests;

/// <summary>Skips when no Docker daemon is reachable, so `dotnet test` still passes on machines without it.</summary>
public sealed class DockerFactAttribute : FactAttribute
{
    public DockerFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("DOCKER_HOST") is null && !File.Exists("/var/run/docker.sock")
            && !OperatingSystem.IsWindows())
            Skip = "Docker is not available.";
    }
}

/// <summary>
/// Real Kafka (KRaft, the same image as docker-compose) and PostgreSQL in containers,
/// with both services running in-process against them.
/// </summary>
public sealed class PlatformFixture : IAsyncLifetime
{
    private readonly int _kafkaPort = FreeTcpPort();
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:16-alpine").Build();
    private readonly IContainer _kafka;
    private readonly string _runId = Guid.NewGuid().ToString("N")[..8];

    public PlatformFixture()
    {
        _kafka = new ContainerBuilder("apache/kafka:4.1.0")
            .WithPortBinding(_kafkaPort, 9092)
            .WithEnvironment(new Dictionary<string, string>
            {
                ["KAFKA_NODE_ID"] = "1",
                ["KAFKA_PROCESS_ROLES"] = "broker,controller",
                ["KAFKA_LISTENERS"] = "PLAINTEXT://:9092,CONTROLLER://:9093",
                ["KAFKA_ADVERTISED_LISTENERS"] = $"PLAINTEXT://localhost:{_kafkaPort}",
                ["KAFKA_CONTROLLER_LISTENER_NAMES"] = "CONTROLLER",
                ["KAFKA_LISTENER_SECURITY_PROTOCOL_MAP"] = "CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT",
                ["KAFKA_CONTROLLER_QUORUM_VOTERS"] = "1@localhost:9093",
                ["KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR"] = "1",
                ["KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR"] = "1",
                ["KAFKA_TRANSACTION_STATE_LOG_MIN_ISR"] = "1",
                ["KAFKA_GROUP_INITIAL_REBALANCE_DELAY_MS"] = "0",
                ["KAFKA_AUTO_CREATE_TOPICS_ENABLE"] = "false",
            })
            .WithWaitStrategy(Wait.ForUnixContainer().UntilMessageIsLogged("Kafka Server started"))
            .Build();
    }

    public string BootstrapServers => $"localhost:{_kafkaPort}";
    public HttpClient Orders { get; private set; } = null!;
    public HttpClient Inventory { get; private set; } = null!;
    public HttpClient Procurement { get; private set; } = null!;
    public HttpClient Finance { get; private set; } = null!;

    private ServiceFactory<OrderServiceApp> _orderService = null!;
    private ServiceFactory<InventoryServiceApp> _inventoryService = null!;
    private ServiceFactory<ProcurementServiceApp> _procurementService = null!;
    private ServiceFactory<FinanceServiceApp> _financeService = null!;

    public async Task InitializeAsync()
    {
        await Task.WhenAll(_postgres.StartAsync(), _kafka.StartAsync());

        _inventoryService = new ServiceFactory<InventoryServiceApp>(Settings("Inventory", "inventory"));
        _orderService = new ServiceFactory<OrderServiceApp>(Settings("Orders", "orders"));
        _procurementService = new ServiceFactory<ProcurementServiceApp>(Settings("Procurement", "procurement", new()
        {
            // One supplier day is one second here, so a receipt lands inside the test timeout.
            ["Procurement:DaySeconds"] = "1",
            ["Procurement:ReceiptPollInterval"] = "00:00:00.200",
            ["Procurement:SeedDemoData"] = "true",
        }));
        _financeService = new ServiceFactory<FinanceServiceApp>(Settings("Finance", "finance"));

        Inventory = _inventoryService.CreateClient();
        Orders = _orderService.CreateClient();
        Procurement = _procurementService.CreateClient();
        Finance = _financeService.CreateClient();
    }

    private Dictionary<string, string> Settings(string connectionName, string database,
        Dictionary<string, string>? extra = null)
    {
        var settings = new Dictionary<string, string>
        {
            [$"ConnectionStrings:{connectionName}"] = new Npgsql.NpgsqlConnectionStringBuilder(_postgres.GetConnectionString()) { Database = database }.ToString(),
            ["Kafka:BootstrapServers"] = BootstrapServers,
            ["Kafka:GroupId"] = $"{database}-{_runId}",
            ["Kafka:ClientId"] = $"{database}-it",
            ["Kafka:OutboxPollInterval"] = "00:00:00.050",
        };
        if (extra is not null)
            foreach (var (key, value) in extra) settings[key] = value;
        return settings;
    }

    public async Task DisposeAsync()
    {
        await _orderService.DisposeAsync();
        await _inventoryService.DisposeAsync();
        await _procurementService.DisposeAsync();
        await _financeService.DisposeAsync();
        await _kafka.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    private static int FreeTcpPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        return ((IPEndPoint)listener.LocalEndpoint).Port;
    }

    private sealed class ServiceFactory<T>(Dictionary<string, string> settings) : WebApplicationFactory<T> where T : class
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            foreach (var (key, value) in settings) builder.UseSetting(key, value);
        }
    }
}

[CollectionDefinition(Name)]
public sealed class PlatformCollection : ICollectionFixture<PlatformFixture>
{
    public const string Name = "platform";
}
