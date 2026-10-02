# Kovanica Protocol — Nix Flake
#
# Usage:
#   nix run github:KovanicaDAG/kovanica-protocol#kovanica-node -- serve
#   nix profile install github:KovanicaDAG/kovanica-protocol#kovanica-node
#
# NixOS module:
#   imports = [ inputs.kovanica-protocol.nixosModules.default ];
#   services.kovanica-node.enable = true;

{
  description = "Kovanica BlockDAG node — GHOSTDAG consensus";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        rustToolchain = pkgs.rust-bin.stable."1.98.0".default.override {
          extensions = [ "rustfmt" "clippy" ];
        };

        kovanica-node = pkgs.rustPlatform.buildRustPackage {
          pname = "kovanica-node";
          version = "0.2.0";
          src = self;
          cargoLock.lockFile = self + "/Cargo.lock";

          buildNoDefaultFeatures = true;
          buildFeatures = [ ];

          nativeBuildInputs = with pkgs; [ pkg-config ];
          buildInputs = with pkgs; [ openssl ] ++ pkgs.lib.optionals pkgs.stdenv.isDarwin [
            pkgs.darwin.apple_sdk.frameworks.Security
            pkgs.darwin.apple_sdk.frameworks.SystemConfiguration
          ];

          cargoBuildFlags = [ "-p" "kovanica-node" ];

          meta = with pkgs.lib; {
            description = "Kovanica BlockDAG node — GHOSTDAG consensus";
            homepage = "https://kovanica.online";
            license = with licenses; [ mit asl20 ];
            maintainers = [ ];
            mainProgram = "kovanica-node";
          };
        };
      in
      {
        packages = {
          inherit kovanica-node;
          default = kovanica-node;
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            rustToolchain
            pkgs.pkg-config
            pkgs.openssl
            pkgs.git
            pkgs.curl
          ];

          RUST_SRC_PATH = "${rustToolchain.override { extensions = [ "rust-src" ]; }}/lib/rustlib/src/rust/library";
        };
      }
    ) // {
      nixosModules.default = { config, lib, pkgs, ... }:
        let
          cfg = config.services.kovanica-node;
        in
        {
          options.services.kovanica-node = {
            enable = lib.mkEnableOption "Kovanica BlockDAG node";

            dataDir = lib.mkOption {
              type = lib.types.path;
              default = "/var/lib/kovanica";
              description = "Data directory for chain state";
            };

            p2pPort = lib.mkOption {
              type = lib.types.port;
              default = 9000;
              description = "P2P listen port";
            };

            httpPort = lib.mkOption {
              type = lib.types.port;
              default = 8080;
              description = "HTTP API port";
            };

            peers = lib.mkOption {
              type = lib.types.str;
              default = "seed.kovanica.online:9000,seed2.kovanica.online:9000";
              description = "Bootstrap peers (comma-separated)";
            };

            mine = lib.mkOption {
              type = lib.types.bool;
              default = false;
              description = "Enable auto-mining";
            };

            mineSecs = lib.mkOption {
              type = lib.types.ints.positive;
              default = 60;
              description = "Block interval in seconds when mining";
            };

            openFirewall = lib.mkOption {
              type = lib.types.bool;
              default = true;
              description = "Open P2P port in firewall";
            };
          };

          config = lib.mkIf cfg.enable {
            systemd.services.kovanica-node = {
              description = "Kovanica BlockDAG Node";
              after = [ "network-online.target" ];
              wants = [ "network-online.target" ];
              wantedBy = [ "multi-user.target" ];

              serviceConfig = {
                Type = "simple";
                ExecStart = "${lib.getExe kovanica-node} serve";
                Restart = "on-failure";
                RestartSec = 5;
                LimitNOFILE = 65536;

                # Security
                NoNewPrivileges = true;
                PrivateTmp = true;
                ProtectSystem = "strict";
                ReadWritePaths = cfg.dataDir;

                # Environment
                Environment = [
                  "KOVANICA_DATA=${cfg.dataDir}"
                  "KOVANICA_P2P_PORT=${toString cfg.p2pPort}"
                  "KOVANICA_HTTP_PORT=${toString cfg.httpPort}"
                  "KOVANICA_PEERS=${cfg.peers}"
                  "KOVANICA_MINE=${if cfg.mine then "1" else "0"}"
                  "KOVANICA_MINE_SECS=${toString cfg.mineSecs}"
                ];
              };
            };

            # Create data directory
            systemd.tmpfiles.rules = [
              "d ${cfg.dataDir} 0700 kovanica kovanica -"
            ];

            # Create kovanica user
            users.users.kovanica = {
              isSystemUser = true;
              group = "kovanica";
              home = cfg.dataDir;
            };

            users.groups.kovanica = {};

            # Firewall
            networking.firewall = lib.mkIf cfg.openFirewall {
              allowedTCPPorts = [ cfg.p2pPort ];
            };
          };
        };
    };
}
