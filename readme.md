# Admin Panel Backend API

This repository contains the backend REST API for the Admin Panel, built using Node.js, Express, and MySQL. It serves as the data management layer for administrative tools, starting with a Wishlist Management module.

---

## 🚀 Features

- **Wishlist Management:** CRUD operations for tracking wishlist items, enforced with a unique title constraint.
- **Health Check:** Endpoint available at `/health` for server status monitoring.
- **Security:** Ready to integrate future password protection/authentication middleware (e.g., using JWT).
- **Environment Agnostic:** Uses separate configuration for development (Dockerized MySQL) and production (External MySQL).

---

## 💻 Tech Stack

- **Runtime:** Node.js (v20+)
- **Framework:** Express.js
- **Database:** MySQL (via `mysql2/promise` driver)
- **Testing:** Jest & Supertest
- **Development Environment:** WSL (Windows Subsystem for Linux) / Docker

---

## 🛠️ Setup and Installation

### Prerequisites

- Node.js (v20+) and npm/pnpm
- Docker and Docker Compose (Highly recommended for development)
- A MySQL server instance (local or external)

### 1. Clone the Repository

```bash
git clone [YOUR_REPOSITORY_URL]
cd admin-api
```
