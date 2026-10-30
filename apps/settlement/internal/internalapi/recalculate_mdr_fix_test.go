package internalapi

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

// BUG-106: an unknown (but well-formed) merchant id is the caller's
// mistake, not a server failure: 404, not 500 recalculate_mdr_failed.
func TestRecalculateMDR_UnknownMerchantIs404(t *testing.T) {
	pool := mustPool(t)
	server := newTestServer(t, pool)
	body := `{"merchantId":"` + uuid.New().String() + `","from":"2026-04-01","to":"2026-05-01"}`
	resp := post(t, server, "/internal/recalculate-mdr", "Bearer "+testToken, body)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("status = %d, want 404 for an unknown merchant", resp.StatusCode)
	}
}

// BUG-106: the range is half-open [from, to); from >= to is empty or
// backwards and must be refused, not silently "recalculate nothing".
func TestRecalculateMDR_EmptyOrBackwardsRangeIs400(t *testing.T) {
	pool := mustPool(t)
	server := newTestServer(t, pool)
	merchantID := insertActiveMerchant(t, pool)
	for _, r := range []string{
		`"from":"2026-05-01","to":"2026-04-01"`,
		`"from":"2026-05-01","to":"2026-05-01"`,
	} {
		body := `{"merchantId":"` + merchantID.String() + `",` + r + `}`
		resp := post(t, server, "/internal/recalculate-mdr", "Bearer "+testToken, body)
		if resp.StatusCode != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", r, resp.StatusCode)
		}
	}
}
