using Microsoft.EntityFrameworkCore;
using Procurement.Service;
using Procurement.Service.Api;
using Procurement.Service.Data;
using Procurement.Service.Messaging;
using OrderPlatform.Messaging;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<ProcurementOptions>(builder.Configuration.GetSection(ProcurementOptions.Section));
builder.Services.AddDbContext<ProcurementDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Procurement")));
builder.Services.AddKafkaMessaging(builder.Configuration)
    .AddOutboxDispatcher<ProcurementDbContext>();
builder.Services.AddScoped<GoodsReceiptService>();
builder.Services.AddHostedService<GoodsReceiptWorker>();

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks().AddDbContextCheck<ProcurementDbContext>(tags: ["ready"]);

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ProcurementDbContext>();
    if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
        await db.Database.MigrateAsync();
    if (app.Configuration.GetValue("Procurement:SeedDemoData", false))
        await CatalogSeeder.SeedAsync(db, scope.ServiceProvider.GetRequiredService<TimeProvider>());
}

app.UseExceptionHandler();
app.UseSwagger();
app.UseSwaggerUI();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
app.MapProcurementEndpoints();

app.Run();

namespace Procurement.Service { public sealed class ProcurementServiceApp; }
