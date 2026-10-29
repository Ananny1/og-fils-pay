# Multi-stage build of apps/settlement. The build cache stays in the builder
# stage, so the 2 GB demo box only keeps the small runtime image.
FROM golang:1.22-alpine AS build

WORKDIR /src
COPY apps/settlement/go.mod apps/settlement/go.sum ./
RUN go mod download
COPY apps/settlement/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/settlement ./cmd/settlement

FROM alpine:3.20
# cmd/settlement embeds time/tzdata, so Asia/Bahrain loads without OS tzdata.
RUN adduser -D -H settlement
WORKDIR /app
COPY --from=build /out/settlement ./settlement
USER settlement
EXPOSE 8091
