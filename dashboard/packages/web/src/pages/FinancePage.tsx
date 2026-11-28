import type { DashboardSnapshot } from '@orderflow/contracts';
import { shortId } from '../lib/events';
import { formatAgo, formatMoney, formatPercent } from '../lib/format';

/**
 * The money the two sagas produce: captures when an order is confirmed, refunds when it is
 * cancelled, and the cost of the goods sold. The reconciliation line checks the ledger against
 * the order totals the read model computed independently.
 */
export function FinancePage({
  snapshot,
  now,
  currency,
}: {
  snapshot: DashboardSnapshot | null;
  now: Date;
  currency: string;
}) {
  const finance = snapshot?.finance;
  const revenueCents = (finance?.capturedCents ?? 0) - (finance?.refundedCents ?? 0);
  const marginRatio = revenueCents > 0 ? (finance!.marginCents / revenueCents) : null;

  return (
    <>
      <header className="masthead">
        <div className="masthead-main">
          <p className="eyebrow">
            <span className="eyebrow-index">03</span>
            Finance
          </p>
          <h1>Follow the money.</h1>
          <p className="lede">
            Every confirmation captures an amount and its standard cost; every cancellation refunds
            it. Amounts are integer cents, so the ledger can be checked exactly.
          </p>
        </div>
        <dl className="masthead-meta">
          <div>
            <dt>Movements</dt>
            <dd>{finance?.ledger.length ?? 0}</dd>
          </div>
          <div>
            <dt>Currency</dt>
            <dd>{currency}</dd>
          </div>
        </dl>
      </header>

      {!snapshot || !finance ? (
        <p className="empty" role="status">
          Waiting for the first update…
        </p>
      ) : (
        <>
          <section className="kpis" aria-label="Money">
            <div className="tile tile-lead">
              <div className="tile-label">Net revenue</div>
              <div className="tile-value">{formatMoney(revenueCents, currency)}</div>
              <div className="tile-hint">
                {formatMoney(finance.capturedCents, currency)} captured ·{' '}
                {formatMoney(finance.refundedCents, currency)} refunded
              </div>
            </div>
            <div className="tile">
              <div className="tile-label">Cost of goods</div>
              <div className="tile-value">{formatMoney(finance.cogsCents, currency)}</div>
              <div className="tile-hint">Recognised with each capture, reversed on refund</div>
            </div>
            <div className="tile">
              <div className="tile-label">Gross margin</div>
              <div className="tile-value">{formatMoney(finance.marginCents, currency)}</div>
              <div className="tile-hint">{formatPercent(marginRatio)} of net revenue</div>
            </div>
          </section>

          <div className="workbench workbench-top">
            <section className="card span-8" aria-labelledby="ledger-title">
              <div className="panel-head">
                <div>
                  <h2 id="ledger-title">Ledger</h2>
                  <p className="card-hint">The most recent money movements, newest first.</p>
                </div>
              </div>
              {finance.ledger.length === 0 ? (
                <p className="empty">No captures yet.</p>
              ) : (
                <table className="stack-table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Kind</th>
                      <th className="num">Amount</th>
                      <th className="num">Cost</th>
                      <th className="num">Margin</th>
                      <th>When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.ledger.slice(0, 12).map((entry) => (
                      <tr key={`${entry.orderId}-${entry.kind}-${entry.occurredAt}`}>
                        <td className="mono stack-sku">
                          <a href={`#/orders/${entry.orderId}`} title={entry.orderId}>
                            {shortId(entry.orderId)}
                          </a>
                        </td>
                        <td data-label="Kind">
                          <span
                            className={`pill ${entry.kind === 'capture' ? 'pill-confirmed' : 'pill-cancelled'}`}
                          >
                            {entry.kind === 'capture' ? 'Captured' : 'Refunded'}
                          </span>
                        </td>
                        <td className="num" data-label="Amount">
                          {formatMoney(entry.amountCents, currency)}
                        </td>
                        <td className="num" data-label="Cost">
                          {formatMoney(entry.costCents, currency)}
                        </td>
                        <td className="num" data-label="Margin">
                          {formatMoney(entry.amountCents - entry.costCents, currency)}
                        </td>
                        <td data-label="When">{formatAgo(entry.occurredAt, now)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card span-4" aria-labelledby="recon-title">
              <h2 id="recon-title">Reconciliation</h2>
              <p className="card-hint">
                Two independent folds of the same events: the ledger and the order totals.
              </p>
              <dl className="facts">
                <dt>Captured</dt>
                <dd>{formatMoney(finance.capturedCents, currency)}</dd>
                <dt>Refunded</dt>
                <dd>{formatMoney(finance.refundedCents, currency)}</dd>
                <dt>Ledger total</dt>
                <dd>{formatMoney(revenueCents, currency)}</dd>
                <dt>Order totals</dt>
                <dd>{formatMoney(snapshot.orders.revenueCents, currency)}</dd>
              </dl>
              <p
                className={`recon-verdict${finance.reconciles === false ? ' is-bad' : ''}`}
                role="status"
              >
                {finance.reconciles == null
                  ? 'No captures yet, so there is nothing to reconcile.'
                  : finance.reconciles
                    ? 'The ledger and the order totals agree.'
                    : 'The ledger and the order totals disagree. A payment event was lost or duplicated.'}
              </p>
              <p className="card-hint facts-note">
                Amounts are integer cents. Every capture is keyed by order id, so a redelivered
                confirmation cannot charge twice.
              </p>
            </section>
          </div>
        </>
      )}
    </>
  );
}
