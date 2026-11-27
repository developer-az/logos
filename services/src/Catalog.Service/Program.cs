using Catalog.Service.Api;
using Catalog.Service.Data;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<CatalogDbContext>(o => o.UseNpgsql(builder.Configuration.GetConnectionString("Catalog")));
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddProblemDetails();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddHealthChecks().AddDbContextCheck<CatalogDbContext>(tags: ["ready"]);

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CatalogDbContext>();
    if (app.Configuration.GetValue("Database:MigrateOnStartup", true))
        await db.Database.MigrateAsync();
    if (app.Configuration.GetValue("Catalog:SeedDemoData", false))
        await CatalogSeeder.SeedAsync(db, scope.ServiceProvider.GetRequiredService<TimeProvider>());
}

app.UseExceptionHandler();
app.UseSwagger();
app.UseSwaggerUI();
app.MapHealthChecks("/health/live", new() { Predicate = _ => false });
app.MapHealthChecks("/health/ready", new() { Predicate = c => c.Tags.Contains("ready") });
app.MapCatalogEndpoints();

app.Run();

namespace Catalog.Service { public sealed class CatalogServiceApp; }
