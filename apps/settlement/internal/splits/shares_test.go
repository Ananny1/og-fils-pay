package splits

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

func TestChildShares_SumToNet(t *testing.T) {
	cases := []struct {
		name       string
		netPayout  money.Fils
		weightsBps []int64
	}{
		{"two equal", 10000, []int64{5000, 5000}},
		{"three round", 9000, []int64{3000, 3000, 4000}},
		{"single child", 5000, []int64{10000}},
		// BUG-016: Delta Marketplace weights with nets that do not divide evenly.
		{"delta 1001", 1001, []int64{5000, 3000, 2000}},
		{"delta 9999", 9999, []int64{5000, 3000, 2000}},
		{"delta 7", 7, []int64{5000, 3000, 2000}},
		{"thirds 1001", 1001, []int64{3333, 3333, 3334}},
		{"thirds 100", 100, []int64{3334, 3333, 3333}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			children := make([]ChildWeight, len(tc.weightsBps))
			for i, w := range tc.weightsBps {
				children[i] = ChildWeight{WeightBps: w}
			}
			shares := ChildShares(tc.netPayout, children)
			var total money.Fils
			for _, s := range shares {
				total += s
			}
			if total != tc.netPayout {
				t.Errorf("sum of shares %d != net payout %d", total, tc.netPayout)
			}
		})
	}
}

// BUG-016: same largest-remainder result as packages/money allocateRemainder.
func TestChildShares_MatchesTSAllocateRemainder(t *testing.T) {
	cases := []struct {
		net     money.Fils
		weights []int64
		want    []money.Fils
	}{
		{1001, []int64{5000, 3000, 2000}, []money.Fils{501, 300, 200}},
		{1001, []int64{3333, 3333, 3334}, []money.Fils{334, 333, 334}},
		{100, []int64{1, 1, 1}, []money.Fils{34, 33, 33}},
		{2, []int64{1, 1, 1}, []money.Fils{1, 1, 0}},
	}
	for _, tc := range cases {
		children := make([]ChildWeight, len(tc.weights))
		for i, w := range tc.weights {
			children[i] = ChildWeight{WeightBps: w}
		}
		got := ChildShares(tc.net, children)
		for i := range tc.want {
			if got[i] != tc.want[i] {
				t.Errorf("ChildShares(%d, %v) = %v, want %v", tc.net, tc.weights, got, tc.want)
				break
			}
		}
	}
}
