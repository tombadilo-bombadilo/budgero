package websocket

import "testing"

func TestBuildCatchUpResponse_MetadataBoundaries(t *testing.T) {
	response := buildCatchUpResponse("space1", 5, []*MutationEntry{
		{ID: "m6", Version: 6},
		{ID: "m7", Version: 7},
	}, 10)

	if response["type"] != "catch_up_response" {
		t.Fatalf("type = %v, want catch_up_response", response["type"])
	}
	if response["space_id"] != "space1" {
		t.Fatalf("space_id = %v, want space1", response["space_id"])
	}
	if response["hasMore"] != true {
		t.Fatalf("hasMore = %v, want true", response["hasMore"])
	}
	if response["nextSinceVersion"] != int64(7) {
		t.Fatalf("nextSinceVersion = %v, want 7", response["nextSinceVersion"])
	}
	if response["latestVersion"] != int64(10) {
		t.Fatalf("latestVersion = %v, want 10", response["latestVersion"])
	}
}

func TestBuildCatchUpResponse_NoMoreAtBoundary(t *testing.T) {
	response := buildCatchUpResponse("space1", 5, []*MutationEntry{
		{ID: "m6", Version: 6},
		{ID: "m7", Version: 7},
	}, 7)

	if response["hasMore"] != false {
		t.Fatalf("hasMore = %v, want false", response["hasMore"])
	}
	if response["nextSinceVersion"] != int64(7) {
		t.Fatalf("nextSinceVersion = %v, want 7", response["nextSinceVersion"])
	}
}

func TestBuildCatchUpResponse_EmptyPage(t *testing.T) {
	response := buildCatchUpResponse("space1", 7, []*MutationEntry{}, 7)

	if response["hasMore"] != false {
		t.Fatalf("hasMore = %v, want false", response["hasMore"])
	}
	if response["nextSinceVersion"] != int64(7) {
		t.Fatalf("nextSinceVersion = %v, want 7", response["nextSinceVersion"])
	}
}

func TestBuildCatchUpResponse_NilMutationsNormalizesToEmptyArray(t *testing.T) {
	response := buildCatchUpResponse("space1", 7, nil, 7)

	mutations, ok := response["mutations"].([]*MutationEntry)
	if !ok {
		t.Fatalf("mutations has unexpected type %T", response["mutations"])
	}
	if mutations == nil {
		t.Fatalf("mutations should not be nil")
	}
	if len(mutations) != 0 {
		t.Fatalf("expected empty mutations slice, got %d", len(mutations))
	}
}
