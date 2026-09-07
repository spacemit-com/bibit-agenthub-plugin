GOARCH ?= $(shell go env GOARCH)

.PHONY: build test vet clean

build:
	CGO_ENABLED=0 GOOS=linux GOARCH=$(GOARCH) go build \
	  -trimpath -ldflags="-s -w" \
	  -o ../artifacts/provider/$(GOARCH)/bibit-agenthub \
	  ./cmd/bibit-agenthub

test:
	go test ./...

vet:
	go vet ./...

clean:
	rm -rf ../artifacts/provider
