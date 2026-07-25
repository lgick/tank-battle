# Server deployment

A guide to preparing a clean VPS, configuring the environment, and running game instances via CI/CD GitHub Actions. The installation scripts live in [.github/deployment/](../../.github/deployment/).

**How it works**: a push to `main` → [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) builds a Docker image and publishes it to GHCR → over SSH it connects to each server from `SERVERS_MATRIX`, generates `.env`, and restarts the `vimp-<domain>` container. On the VPS, Nginx terminates HTTPS and proxies to the app port.

## 📋 Prerequisites

1. A **VPS** running Ubuntu 20.04, 22.04, or 24.04.
2. A **domain name** pointed to your server's IP.
3. **SSH access** to the server (preferably with sudo rights).
4. Locally installed **Git** and a cloned project repository.

## Step 1: DNS (domain setup)

Before configuring the server, create an **A record** at your domain registrar:

- **Type:** `A`
- **Host:** `game` (e.g. for game.example.com)
- **Value:** `YOUR_SERVER_IP`

## Step 2: Initial system setup (one time)

Performed **once** on a new server. The script installs Nginx, Docker, Fail2Ban and configures the firewall.

1. Upload the scripts to the server:

   ```bash
   scp .github/deployment/*.sh root@YOUR_SERVER_IP:~/vimp-deployment-scripts/
   ```

2. Connect over SSH and make the scripts executable:

   ```bash
   ssh root@YOUR_SERVER_IP

   cd ~/vimp-deployment-scripts
   chmod +x *.sh
   ```

3. Prepare the VPS:

   ```bash
   ./install-system.sh
   ```

**What will happen:**

- the required packages are installed;
- ports are opened (the script asks for confirmation);
- the project root folder `~/vimp_projects` is created;
- Nginx security keys are generated.

## Step 3: Adding a game server

Performed each time you need to bring up a **new game world** (e.g. `game.example.com`).

1. On the server, run:

   ```bash
   cd ~/vimp-deployment-scripts
   ./add-server.sh
   ```

2. Follow the installation wizard:
   - enter the **domain** (e.g. `game.example.com`);
   - enter the **port** (e.g. `3005`) — **remember it**;
   - enter an email (for SSL notifications).

**Result:**

- the project folder `~/vimp_projects/game.example.com` is created;
- an SSL certificate (Let's Encrypt) is obtained;
- Nginx is configured (HTTPS proxying to the specified port).

> ⚠️ The server is configured but **empty** — the game will not start until the next step is done.

## Step 4: Configuration and launch (CI/CD)

The server list is configured via GitHub repository variables.

1. Open **Settings → Secrets and variables → Actions → the Variables tab**.
2. Create (or edit) the `SERVERS_MATRIX` variable:

   ```json
   [
     {
       "ip": "YOUR_SERVER_IP",
       "domain": "game.example.com",
       "port": 3005,
       "players": 30,
       "map": "garden",
       "round_time": 120000,
       "map_time": 600000,
       "friendly_fire": false
     }
   ]
   ```

   _(`domain` and `port` must strictly match those specified in Step 3; the field values correspond to the `TANK_BATTLE_*` variables — see [configuration.md](configuration.md#environment-variables-env))._

3. On the **Secrets** tab there must exist the secrets for the deploy SSH access: `SERVER_USER` (the VPS user) and `SERVER_SSH_KEY` (the private key).
4. Go to the **Actions** tab and re-run the pipeline manually (Re-run jobs), or `git push` to the `main` branch — the system will deploy the game to all servers in the list.

## 🛠 Maintenance and removal

### Changing server settings

Edit `SERVERS_MATRIX` in the GitHub settings and run the Action again.

### Updating the game

Just `git push` to the `main` branch — GitHub Actions will automatically update all servers from `SERVERS_MATRIX`.

### Removing a server

On the VPS, use `./delete-server.sh` — it removes the Nginx configs, the project folder, and stops the container.

> ⚠️ After that, delete this server's entry from `SERVERS_MATRIX` on GitHub!

### Viewing logs on the VPS

| Action | Docker command |
| --- | --- |
| View logs (node.js) | `docker logs -f vimp-<domain>` |
| List processes | `docker ps -a` |
| Restart | `docker restart vimp-<domain>` |
| Stop | `docker stop vimp-<domain>` |
| Resource usage | `docker stats` |
