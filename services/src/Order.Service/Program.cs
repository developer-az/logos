using Microsoft.EntityFrameworkCore;
using Order.Service.Api;
using Order.Service.Data;
using Order.Service.Messaging;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<OrdersDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Orders")));
builder.Services.AddKafkaMessaging(builder.Configuration)
    .AddOutboxDispatcher<OrdersDbContext>()
    .AddKafkaConsumer<InventoryEventsHandler>(Topics.InventoryEvents);

builder.Services.AddProblemDetails();
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks().AddDbContextCheck<OrdersDbContext>(tags: ["ready"]);

var app = builder.Build();

if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<OrdersDbContext>().Database.MigrateAsync();
}

app.UseExceptionHandler();
app.UseSwagger();
app.UseSwaggerUI();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
app.MapOrderEndpoints();

app.Run();

namespace Order.Service { public sealed class OrderServiceApp; }
