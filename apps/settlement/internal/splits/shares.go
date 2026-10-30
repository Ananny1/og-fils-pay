package splits

import (
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights.
//
// BUG-016: largest-remainder allocation, the Go port of packages/money
// allocateRemainder. Each child gets floor(net*w/sum(w)); the fils left over
// (fewer than len(children)) go one each to the largest remainders, ties to
// the lower index. The shares always sum to netPayout exactly. Rounding each
// child on its own (ApplyRateFils) lost or invented fils.
func ChildShares(netPayout money.Fils, children []ChildWeight) []money.Fils {
	out := make([]money.Fils, len(children))
	var sumWeights int64
	for _, c := range children {
		sumWeights += c.WeightBps
	}
	if sumWeights <= 0 || netPayout <= 0 {
		return out // nothing to pay (empty or fee-only batch)
	}

	remainders := make([]int64, len(children))
	var allocated money.Fils
	for i, c := range children {
		product := int64(netPayout) * c.WeightBps
		out[i] = money.Fils(product / sumWeights)
		remainders[i] = product % sumWeights
		allocated += out[i]
	}

	order := make([]int, len(children))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		return remainders[order[a]] > remainders[order[b]]
	})
	for k := 0; allocated < netPayout && k < len(order); k++ {
		out[order[k]]++
		allocated++
	}
	return out
}
