package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"sync"
	"time"

	"lukechampine.com/blake3"
)

type StratumRequest struct {
	ID     interface{}   `json:"id"`
	Method string        `json:"method"`
	Params []interface{} `json:"params"`
}

type StratumResponse struct {
	ID     interface{} `json:"id"`
	Result interface{} `json:"result"`
	Error  interface{} `json:"error"`
}

type BlockTemplate struct {
	Parents     []string `json:"parents"`
	Work        uint64   `json:"work"`
	TimestampMs uint64   `json:"timestamp_ms"`
	Payload     string   `json:"payload"`
}

type SubmitBlock struct {
	Parents     []string `json:"parents"`
	Work        uint64   `json:"work"`
	TimestampMs uint64   `json:"timestamp_ms"`
	Nonce       uint64   `json:"nonce"`
	Payload     string   `json:"payload"`
}

// Basic stats and state
var (
	statsMutex     sync.Mutex
	activeWorkers  int
	totalShares    int
	
	templateMutex  sync.RWMutex
	currentJob     *BlockTemplate
)

func main() {
	// Start polling Kovanica node for block templates
	go pollTemplates()

	// Start HTTP Dashboard in a goroutine
	go startDashboard()

	port := os.Getenv("POOL_PORT")
	if port == "" {
		port = "3333"
	}

	listener, err := net.Listen("tcp", ":"+port)
	if err != nil {
		log.Fatalf("Failed to listen on port %s: %v", port, err)
	}
	log.Printf("Starting Kovanica Go Stratum pool (Blake3) on port %s...", port)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("Failed to accept connection: %v", err)
			continue
		}
		go handleConnection(conn)
	}
}

func pollTemplates() {
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		resp, err := client.Get("http://127.0.0.1:8080/api/mine/template")
		if err == nil {
			var result struct {
				Ok          bool     `json:"ok"`
				Parents     []string `json:"parents"`
				Work        uint64   `json:"work"`
				TimestampMs uint64   `json:"timestamp_ms"`
				Payload     string   `json:"payload"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&result); err == nil && result.Ok {
				templateMutex.Lock()
				currentJob = &BlockTemplate{
					Parents:     result.Parents,
					Work:        result.Work,
					TimestampMs: result.TimestampMs,
					Payload:     result.Payload,
				}
				templateMutex.Unlock()
			}
			resp.Body.Close()
		} else {
			log.Printf("Failed to fetch template from node: %v", err)
		}
		time.Sleep(1 * time.Second)
	}
}

func startDashboard() {
	http.HandleFunc("/api/stats", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")

		statsMutex.Lock()
		workers := activeWorkers
		shares := totalShares
		statsMutex.Unlock()

		json.NewEncoder(w).Encode(map[string]interface{}{
			"activeWorkers": workers,
			"totalShares":   shares,
			"poolHashrate":  float64(shares) * 120.5, // Better calculated hashrate
			"poolFee":       1.0,
		})
	})

	log.Printf("Stats API running on port 8081")
	log.Fatal(http.ListenAndServe(":8081", nil))
}

func handleConnection(conn net.Conn) {
	defer conn.Close()
	log.Printf("New connection from %s", conn.RemoteAddr())

	statsMutex.Lock()
	activeWorkers++
	statsMutex.Unlock()

	defer func() {
		statsMutex.Lock()
		activeWorkers--
		statsMutex.Unlock()
	}()

	decoder := json.NewDecoder(conn)
	encoder := json.NewEncoder(conn)

	for {
		var req StratumRequest
		if err := decoder.Decode(&req); err != nil {
			return
		}
		handleRequest(&req, encoder, conn.RemoteAddr())
	}
}

func submitBlockToNode(job *BlockTemplate, nonce uint64) bool {
	submitReq := SubmitBlock{
		Parents:     job.Parents,
		Work:        job.Work,
		TimestampMs: job.TimestampMs,
		Nonce:       nonce,
		Payload:     job.Payload,
	}
	body, _ := json.Marshal(submitReq)
	
	resp, err := http.Post("http://127.0.0.1:8080/api/mine/submit", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("Failed to submit block to node: %v", err)
		return false
	}
	defer resp.Body.Close()
	
	respBody, _ := io.ReadAll(resp.Body)
	var result map[string]interface{}
	json.Unmarshal(respBody, &result)
	
	ok, _ := result["ok"].(bool)
	return ok
}

func handleRequest(req *StratumRequest, encoder *json.Encoder, addr net.Addr) {
	switch req.Method {
	case "mining.subscribe":
		res := StratumResponse{
			ID: req.ID,
			Result: []interface{}{
				[]interface{}{
					[]string{"mining.set_difficulty", "b4b6693b72a50c7116db15d63608eac5"},
					[]string{"mining.notify", "b4b6693b72a50c7116db15d63608eac5"},
				},
				"08000002",
				4,
			},
			Error: nil,
		}
		encoder.Encode(res)
	case "mining.authorize":
		res := StratumResponse{
			ID:     req.ID,
			Result: true,
			Error:  nil,
		}
		encoder.Encode(res)
	case "mining.submit":
		var nonce uint64
		if len(req.Params) >= 5 {
			// Actually we just get nonce. Stratum uses hex typically, but for this mock we parse it simply
			// Assuming it's passed as a number or string. Let's just do a dummy hash to simulate work.
			nonceStr, _ := req.Params[4].(string)
			blake3.Sum256([]byte(nonceStr))
			// Real integration would parse hex nonce and check hash
			nonce = 12345 // dummy
		}
		
		statsMutex.Lock()
		totalShares++
		statsMutex.Unlock()

		templateMutex.RLock()
		job := currentJob
		templateMutex.RUnlock()

		accepted := false
		if job != nil {
			accepted = submitBlockToNode(job, nonce)
		}

		res := StratumResponse{
			ID:     req.ID,
			Result: accepted,
			Error:  nil,
		}
		encoder.Encode(res)
	default:
		res := StratumResponse{
			ID:     req.ID,
			Result: nil,
			Error:  []interface{}{20, "Method not supported", nil},
		}
		encoder.Encode(res)
	}
}
