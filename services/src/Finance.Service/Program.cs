using Finance.Service.Api;
using Finance.Service.Data;
using Finance.Service.Messaging;
using Microsoft.EntityFrameworkCore;
using OrderPlatform.Contracts;
using OrderPlatform.Messaging;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<FinanceDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Finance")));
builder.Services.AddKafkaMessaging(builder.Configuration)
    .AddOutboxDispatcher<FinanceDbContext>()
    .AddKafkaConsumer<OrderOutcomesHandler>(Topics.OrderEvents);

builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks().AddDbContextCheck<FinanceDbContext>(tags: ["ready"]);

var app = builder.Build();

if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
{
    await using var scope = app.Services.CreateAsyncScope();
    await scope.ServiceProvider.GetRequiredService<FinanceDbContext>().Database.MigrateAsync();
}

app.UseExceptionHandler();
app.UseSwagger();
app.UseSwaggerUI();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
app.MapFinanceEndpoints();

app.Run();

namespace Finance.Service { public sealed class FinanceServiceApp; }
