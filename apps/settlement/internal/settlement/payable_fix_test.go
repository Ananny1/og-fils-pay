package settlement

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// BUG-021: net payout went through float32 (24-bit mantissa), so any batch
// above ~16,777 BD lost fils.
func TestNetPayableFils_ExactForLargeBatches_Fix(t *testing.T) {
	cases := []struct{ gross, fee money.Fils }{
		{20_000_001, 500_000},
		{16_777_217, 0},
		{123_456_789, 3_086_419},
		{4747, 119},
		{0, 0},
	}
	for _, tc := range cases {
		if got, want := NetPayableFils(tc.gross, tc.fee), tc.gross-tc.fee; got != want {
			t.Errorf("NetPayableFils(%d, %d) = %d, want %d", tc.gross, tc.fee, got, want)
		}
	}
}
