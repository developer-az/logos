using Confluent.Kafka;
using Metrics.Core.Domain;
using Metrics.Service.Kafka;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<KafkaOptions>(builder.Configuration.GetSection(KafkaOptions.Section));
builder.Services.AddSingleton<IIssueTimelineStore, InMemoryIssueTimelineStore>();
builder.Services.AddSingleton<IssueEventProcessor>();
builder.Services.AddSingleton<ConsumerReadiness>();
builder.Services.AddSingleton<IProducer<string, string>>(sp =>
    new ProducerBuilder<string, string>(ClientConfigs.Producer(sp.GetRequiredService<IOptions<KafkaOptions>>().Value)).Build());
builder.Services.AddHostedService<IssueEventConsumer>();

var app = builder.Build();

app.MapGet("/healthz/live", () => Results.Ok());
app.MapGet("/healthz/ready", (ConsumerReadiness r) => r.IsReady ? Results.Ok() : Results.StatusCode(503));

app.MapGet("/api/issues/{issueKey}/metrics", (string issueKey, IIssueTimelineStore store) =>
{
    if (!store.TryGet(issueKey, out var timeline) || timeline is null) return Results.NotFound();
    lock (timeline) return Results.Ok(timeline.Compute());
});

app.MapGet("/api/projects/{projectKey}/flow", (string projectKey, IIssueTimelineStore store) =>
{
    var metrics = store.All().Select(t => { lock (t) return t.Compute(); });
    return Results.Ok(FlowSummary.From(projectKey, metrics));
});

app.Lifetime.ApplicationStopping.Register(() =>
    app.Services.GetRequiredService<IProducer<string, string>>().Flush(TimeSpan.FromSeconds(10)));

app.Run();
