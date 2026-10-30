package splits

import (
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights with
// the largest-remainder method — the Go port of packages/money's
// allocateRemainder. Shares are floored, then the leftover fils go one each
// to the largest remainders (ties: lowest index), so the shares always sum
// to netPayout exactly (BUG-016). Weights are relative to their own sum,
// which is 10000 for a correctly configured parent. A non-positive net or
// all-zero weights yields all-zero shares.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	out := make([]money.Fils, len(children))
	var weightSum int64
	for _, c := range children {
		weightSum += c.WeightBps
	}
	if netPayout <= 0 || weightSum <= 0 {
		return out
	}

	remainders := make([]int64, len(children))
	var allocated money.Fils
	for i, c := range children {
		product := int64(netPayout) * c.WeightBps
		out[i] = money.Fils(product / weightSum)
		remainders[i] = product % weightSum
		allocated += out[i]
	}

	order := make([]int, len(children))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return remainders[order[a]] > remainders[order[b]] })
	for k := 0; allocated < netPayout; k++ {
		out[order[k]]++
		allocated++
	}
	return out
}
