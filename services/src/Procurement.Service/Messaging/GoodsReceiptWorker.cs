using Microsoft.Extensions.Options;
using Procurement.Service;

namespace Procurement.Service.Messaging;

/// <summary>Polls for purchase orders whose lead time has elapsed. All work is in a scope per tick.</summary>
public sealed class GoodsReceiptWorker(
    IServiceScopeFactory scopes,
    IOptions<ProcurementOptions> options,
    ILogger<GoodsReceiptWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.Value.ReceiptPollInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await using var scope = scopes.CreateAsyncScope();
                try
                {
                    await scope.ServiceProvider.GetRequiredService<GoodsReceiptService>()
                        .ReceiveDueAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    return;
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Receiving due purchase orders failed; the next tick retries");
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down.
        }
    }
}
