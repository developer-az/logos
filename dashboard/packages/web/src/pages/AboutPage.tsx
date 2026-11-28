/**
 * The build notes a technical reviewer actually reads: what is real, what the demo simulates,
 * and which failure cases are handled.
 */
export function AboutPage() {
  return (
    <>
      <header className="masthead">
        <div className="masthead-main">
          <p className="eyebrow">
            <span className="eyebrow-index">08</span>
            The build
          </p>
          <h1>What this is, and what is real.</h1>
          <p className="lede">
            An order platform built around one idea: every state change is an event, and every
            event is safe to deliver twice. Here is what runs on the server, what runs in your
            browser, and which failures are handled.
          </p>
        </div>
        <a className="quiet-button" href="https://github.com/developer-az/logos">
          Source
        </a>
      </header>

      <div className="workbench workbench-top">
        <section className="card span-8" aria-labelledby="what-title">
          <h2 id="what-title">What is real</h2>
          <p className="card-hint">
            The C# services, Kafka, PostgreSQL and the dashboard API run as a real distributed
            system. This public page is the same contracts and read model, folded in your browser,
            so the demo cannot rot when a free-tier backend sleeps.
          </p>
          <table className="prose-table">
            <tbody>
              <tr>
                <th scope="row">Order service</th>
                <td>
                  C# / .NET 10, EF Core, PostgreSQL. Accepts orders and runs the saga to a decision.
                </td>
              </tr>
              <tr>
                <th scope="row">Inventory service</th>
                <td>
                  C# / .NET 10. Reserves all lines or none, releases on cancellation, publishes stock
                  levels with a per-SKU version.
                </td>
              </tr>
              <tr>
                <th scope="row">Procurement service</th>
                <td>
                  C# / .NET 10. Quotes every SKU from three suppliers, raises purchase orders and
                  publishes the goods receipt when the lead time elapses.
                </td>
              </tr>
              <tr>
                <th scope="row">Finance service</th>
                <td>
                  C# / .NET 10. Reads order outcomes, captures the charge with its standard cost and
                  refunds a cancelled order. Integer cents, idempotent per order.
                </td>
              </tr>
              <tr>
                <th scope="row">Catalog service</th>
                <td>
                  C# / .NET 10. Owns shelf prices and names. The order service prices every line from
                  it, so a client cannot set what it is charged.
                </td>
              </tr>
              <tr>
                <th scope="row">Transport</th>
                <td>
                  Kafka, one topic per service, keyed so one order&apos;s events stay ordered.
                  Transactional outbox and inbox give exactly-once effects on at-least-once delivery.
                </td>
              </tr>
              <tr>
                <th scope="row">Dashboard API</th>
                <td>
                  TypeScript, Fastify. Consumes both topics, folds an in-memory read model and streams
                  snapshots over Server-Sent Events.
                </td>
              </tr>
              <tr>
                <th scope="row">This page</th>
                <td>
                  React. The same contract parser and the same projection, running in the browser with
                  a seeded simulator. Every service's events run through that one path, so the demo
                  and the live deployment render the same read model.
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="card span-4" aria-labelledby="try-title">
          <h2 id="try-title">Try it in two minutes</h2>
          <ol className="guide">
            <li>
              <a href="#/">Order a SKU</a> and open its trace: placed, reserved, confirmed, with the
              time between steps.
            </li>
            <li>
              <a href="#/sourcing">Buy stock from a supplier</a> and watch the receipt raise the
              level the store is selling against.
            </li>
            <li>
              <a href="#/finance">Check the ledger</a>: captures, refunds, cost of goods, and whether
              the two folds agree.
            </li>
            <li>
              <a href="#/incidents">Break the stream</a>: a duplicate, a malformed message, a replay
              that stays poison.
            </li>
            <li>
              <a href="#/ops">Watch the control tower</a> while all of that happens.
            </li>
          </ol>
        </section>

        <section className="card span-6" aria-labelledby="fails-title">
          <h2 id="fails-title">What breaks, and what holds</h2>
          <dl className="notes-list">
            <dt>Overselling</dt>
            <dd>
              Reservation is all-or-none per order and guarded per SKU, so two orders cannot both take
              the last unit.
            </dd>
            <dt>Redelivery</dt>
            <dd>
              Consumers dedupe on event id. A stock snapshot older than one already applied is
              ignored by version.
            </dd>
            <dt>Out-of-order topics</dt>
            <dd>
              Order and inventory events are merged by event time, so a trace stays chronological
              even though the topics advance independently.
            </dd>
            <dt>Poison messages</dt>
            <dd>
              Invalid payloads are dead-lettered, never applied. The incidents page shows the body
              and the validation error.
            </dd>
            <dt>Broken order saga</dt>
            <dd>
              An order only moves forward: placed, then confirmed or rejected, then optionally
              cancelled. A replayed decision cannot resurrect it.
            </dd>
          </dl>
        </section>

        <section className="card span-6" aria-labelledby="decisions-title">
          <h2 id="decisions-title">Decisions worth defending</h2>
          <dl className="notes-list">
            <dt>Choreography, not orchestration</dt>
            <dd>
              No central saga coordinator. Each service reacts to a topic and publishes its own
              outcome, so adding a consumer needs no change to the producers.
            </dd>
            <dt>Outbox instead of two-phase commit</dt>
            <dd>
              The database write and the event publish cannot be atomic across two systems, so the
              event is written in the same transaction and relayed afterwards.
            </dd>
            <dt>Integer cents</dt>
            <dd>
              Money is converted once, at the edge, and summed as integers. No float drift in the
              ledger or the reconciliation.
            </dd>
            <dt>Prices are not the client's</dt>
            <dd>
              Checkout sends SKUs and quantities; the order service reads the price from the
              catalogue. If the catalogue cannot answer, the order is refused rather than priced
              from an untrusted number.
            </dd>
            <dt>An honest demo</dt>
            <dd>
              The public build labels what is simulated instead of implying a backend is running.
              The same parser and projection make the simulation a fair test of the read model.
            </dd>
          </dl>
        </section>
      </div>
    </>
  );
}
