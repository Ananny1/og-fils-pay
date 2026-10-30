package settlement

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// BUG-021: net payout must be exact integer fils for any size of batch.
func TestNetPayableFils_ExactForLargeBatches(t *testing.T) {
	cases := []struct{ gross, fee, want int64 }{
		{20_000_001, 0, 20_000_001},               // 20,000.001 BD
		{20_000_001, 450_000, 19_550_001},         // 20,000.001 BD - 450 BD fee
		{123_456_789, 2_469_135, 120_987_654},     // 123,456.789 BD
		{2_147_483_647, 1, 2_147_483_646},         // int32 max
		{9_000_000_000_001, 7, 8_999_999_999_994}, // well past float range
		{1000, 25, 975},
	}
	for _, c := range cases {
		if got := NetPayableFils(money.Fils(c.gross), money.Fils(c.fee)); int64(got) != c.want {
			t.Errorf("NetPayableFils(%d, %d) = %d, want %d", c.gross, c.fee, got, c.want)
		}
	}
}
