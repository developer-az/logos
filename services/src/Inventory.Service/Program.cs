using Inventory.Service.Api;
using Inventory.Service.Data;
using Inventory.Service.Messaging;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<InventoryDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Inventory")));
builder.Services.AddKafkaMessaging(builder.Configuration)
    .AddOutboxDispatcher<InventoryDbContext>()
    .AddKafkaConsumer<OrderEventsHandler>(Topics.OrderEvents);

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks().AddDbContextCheck<InventoryDbContext>(tags: ["ready"]);

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<InventoryDbContext>();
    if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
        await db.Database.MigrateAsync();
    if (app.Configuration.GetValue("Inventory:SeedDemoData", false))
        await DemoSeeder.SeedAsync(db, scope.ServiceProvider.GetRequiredService<TimeProvider>());
}

app.UseExceptionHandler();
app.UseSwagger();
app.UseSwaggerUI();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
app.MapInventoryEndpoints();

app.Run();

namespace Inventory.Service { public sealed class InventoryServiceApp; }
