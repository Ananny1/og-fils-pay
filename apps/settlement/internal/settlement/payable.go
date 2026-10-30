package settlement

import (
	"github.com/filspay/settlement/internal/money"
)

// NetPayableFils derives the net payout from frozen gross and fee totals.
// BUG-021: plain integer fils subtraction. The old float32 BD maths lost
// fils above ~16,777 BD (float32 has a 24-bit mantissa).
func NetPayableFils(grossFils, feeFils money.Fils) money.Fils {
	return grossFils - feeFils
}
