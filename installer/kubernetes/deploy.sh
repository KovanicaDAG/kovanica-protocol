#!/usr/bin/env bash
# Kovanica Protocol — Kubernetes Deployment
#
# Deploys kovanica-node to a Kubernetes cluster.
#
# Usage:
#   kubectl apply -f deployment.yaml
#   # or via Helm:
#   helm install kovanica ./chart

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${BLUE}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
die()   { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

command -v kubectl >/dev/null 2>&1 || die "kubectl not found"

cd "$(dirname "$0")"

info "Deploying Kovanica node to Kubernetes..."

# Create namespace
kubectl create namespace kovanica 2>/dev/null || true

# Apply manifests
kubectl apply -f - <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  name: kovanica
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: kovanica-config
  namespace: kovanica
data:
  KOVANICA_DATA: "/var/lib/kovanica"
  KOVANICA_P2P_PORT: "9000"
  KOVANICA_HTTP_PORT: "8080"
  KOVANICA_PEERS: "seed.kovanica.online:9000,seed2.kovanica.online:9000"
  KOVANICA_MINE: "0"
  KOVANICA_MINE_SECS: "60"
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: kovanica-node
  namespace: kovanica
spec:
  replicas: 3
  serviceName: kovanica-headless
  selector:
    matchLabels:
      app: kovanica-node
  template:
    metadata:
      labels:
        app: kovanica-node
    spec:
      containers:
        - name: kovanica
          image: kovanica/kovanica-node:latest
          ports:
            - containerPort: 9000
              name: p2p
            - containerPort: 8080
              name: http
          envFrom:
            - configMapRef:
                name: kovanica-config
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "2Gi"
              cpu: "2000m"
          livenessProbe:
            httpGet:
              path: /api/head
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /api/head
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          volumeMounts:
            - name: data
              mountPath: /var/lib/kovanica
      terminationGracePeriodSeconds: 30
  volumeClaimTemplates:
    - metadata:
        name: data
      spec:
        accessModes: ["ReadWriteOnce"]
        resources:
          requests:
            storage: 5Gi
---
apiVersion: v1
kind: Service
metadata:
  name: kovanica-headless
  namespace: kovanica
spec:
  clusterIP: None
  selector:
    app: kovanica-node
  ports:
    - port: 9000
      name: p2p
    - port: 8080
      name: http
---
apiVersion: v1
kind: Service
metadata:
  name: kovanica-explorer
  namespace: kovanica
spec:
  type: LoadBalancer
  selector:
    app: kovanica-node
  ports:
    - port: 80
      targetPort: 8080
      name: http
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kovanica-ingress
  namespace: kovanica
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
spec:
  rules:
    - host: explorer.kovanica.online
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kovanica-explorer
                port:
                  number: 80
EOF

ok "Kubernetes deployment applied!"
echo ""
echo -e "  Pods:     ${CYAN}kubectl -n kovanica get pods${NC}"
echo -e "  Logs:     ${CYAN}kubectl -n kovanica logs -f deployment/kovanica-node${NC}"
echo -e "  Status:   ${CYAN}kubectl -n kovanica get statefulset${NC}"
echo ""
