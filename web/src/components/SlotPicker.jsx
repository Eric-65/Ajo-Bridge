import { collateralOf, quoteSlot } from '@shared/ajoEngine.js';

import { near, shortName } from '../lib/format.js';
import { Cta } from './ui.jsx';

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

/**
 * The template's "SEP 2026 ✓ BOOKED / OCT 2026 › RESERVE" pair, as payout slots.
 * Taken slots are grey with a tick; open slots are mint with the collateral as helper text.
 */
export function SlotPicker({ circle, account, onTake, busySlot, limit }) {
  const slots = circle.slots.map((holder, i) => ({ holder, quote: quoteSlot(circle, i + 1) }));
  const shown = limit ? slots.slice(0, limit) : slots;
  const alreadyIn = Boolean(account && circle.members[account]);
  return (
    <ul className="slots">
      {shown.map(({ holder, quote }) => {
        const member = holder ? circle.members[holder] : null;
        const mine = holder && holder === account;
        return (
          <li key={quote.slot} className="slot" data-mine={mine || undefined}>
            <span className="slot__label">Paid {ORDINAL[quote.slot - 1]}</span>
            {holder ? (
              <Cta size="sm" done>{mine ? 'Yours' : 'Taken'}</Cta>
            ) : (
              <Cta size="sm" onClick={() => onTake?.(quote.slot)} busy={busySlot === quote.slot} disabled={!onTake || alreadyIn || undefined}>
                Take slot {quote.slot}
              </Cta>
            )}
            <span className="slot__help">
              {holder
                ? `${shortName(holder)} · ${near(collateralOf(member))} of ${near(quote.collateral)} NEAR locked`
                : `Lock ${near(quote.collateral)} NEAR. ${quote.fee_share > quote.fee ? `Earn ${near(quote.fee_share - quote.fee)}` : quote.fee > quote.fee_share ? `Costs ${near(quote.fee - quote.fee_share)}` : 'No fee'} for the wait.`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
