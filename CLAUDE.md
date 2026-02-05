# Admin Panel Backend API - Audit Documentation

## Project Overview
A **Node.js/Express REST API** for managing admin wishlists with integrated Google OAuth, MySQL database, and Cloudflare R2 image storage.

**Core Purpose:** Secure CRUD operations on wishlist items and associated images with role-based access control.

---

## Architecture

```
api-admin/
├── server.js                 # Express app & routes
├── src/
│   ├── database.js          # MySQL pool (multi-env)
│   ├── middleware/authMiddleware.js # JWT & admin checks
│   ├── routes/
│   │   ├── auth.js          # Google OAuth + user management
│   │   └── wishlist.js      # CRUD & image operations
│   └── service/
│       ├── googleAuth.js    # Token verification
│       └── imageProvider.js # R2 operations
└── tests/                    # Jest suite
```

---

## Core Features

### 1. Authentication & Authorization
- **Google OAuth:** Token verification via `google-auth-library`
- **JWT Tokens:** 7-day expiring tokens on login
- **Middleware Stack:** `requireAuth` → `verifyAdmin`
- **Test Mode:** `LOCAL_TEST` token bypasses OAuth

**Key Files:** `authMiddleware.js`, `auth.js`, `googleAuth.js`

### 2. Wishlist CRUD
**Fields:** `id`, `title` (UNIQUE), `description`, `category`, `active`, `createdAt`, `updated`

| Method | Route | Auth | Admin | Purpose |
|--------|-------|------|-------|---------|
| GET | `/wishlist/active` | ❌ | ❌ | Public active items |
| GET | `/wishlist/` | ✅ | ❌ | All items |
| POST | `/wishlist/` | ✅ | ✅ | Create |
| PUT | `/wishlist/:id` | ✅ | ✅ | Update |
| DELETE | `/wishlist/:id` | ✅ | ✅ | Delete |

### 3. Image Management
Three types: **R2 uploads** (max 5MB), **Attached R2 references**, **External URLs**

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/wishlist/images/gallery` | List all R2 images |
| POST | `/wishlist/:id/images` | Upload to R2 |
| POST | `/wishlist/:id/images/attach/` | Attach existing R2 |
| POST | `/wishlist/:id/images/url` | Add external URL |
| DELETE | `/wishlist/:id/images/:imageId` | Delete specific image |
| DELETE | `/wishlist/:id/images/` | Delete all images |

---

## Database

**MySQL Configuration:**
- Connection pooling (limit: 10, queue: 0)
- Environment-specific credentials (DEV/PROD/TEST)
- Auto-connection test on startup

**Schema:**
- `wishlist`: Items with UNIQUE title constraint
- `wish_images`: M2M with `display_order`
- `users`: Google OAuth + admin flag

---

## Security Assessment

### ✅ Strengths
- JWT verification with expiration
- Admin role enforcement on mutations
- CORS allowlist configuration
- SQL parameterized queries (injection-proof)
- File type & size validation (5MB limit)

### ⚠️ Potential Gaps
- Google token error returns null (no exception)
- CORS fallback to wildcard if `FRONTEND_ORIGINS` empty
- No logout endpoint (304 stub)
- No rate limiting on auth
- No input sanitization (relies on DB constraints)

---

## API Design

### Response Format
- JSON only
- Errors: `{ error: "message" }`
- Standard HTTP codes (201 created, 400 bad request, 401 auth, 403 forbidden, 404 not found, 409 conflict, 500 server error)

### Data Aggregation
Wishlist endpoints perform LEFT JOIN then aggregate in-app:
```javascript
wishlistMap[id] = { ...item, images: [] }
```

### Duplicate Prevention
MySQL UNIQUE constraint on `title` + catches `ER_DUP_ENTRY` for 409 response

---

## Development & Testing

**Scripts:**
```bash
npm start              # Production server
npm run dev           # Nodemon (development)
npm test              # Jest suite
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

**Test Setup:**
- Jest 30.2.0 + Supertest
- ESM support: `NODE_OPTIONS=--experimental-vm-modules`
- Pattern: `**/tests/**/*.test.js`

**Middleware:**
- CORS with origin validation
- JSON body parsing
- 2-second artificial delay in dev (simulate latency)
- Static `/uploads` route (non-production only)

---

## Data Flow Examples

### Read Wishlist with Images
```
GET /wishlist/active
→ SELECT w.*, i.* FROM wishlist w LEFT JOIN wish_images i
→ Aggregate in app code (map wish → images array)
→ Return { id, title, ..., images: [...] }
```

### Upload Image to R2
```
POST /wishlist/:id/images (multipart form)
→ Multer validates type + size
→ uploadToR2() → R2 bucket
→ INSERT wish_images record (auto display_order)
→ Return { id, filename, url, path }
```

### Authentication
```
POST /auth/login { token: "google-id-token" }
→ verifyGoogleToken() (or LOCAL_TEST bypass)
→ Query users by googleId/email
→ Check isAdmin (must be true)
→ Generate JWT + calc expiry
→ Return { token, user, expiresAt }
```

---

## Known Issues

| Status | Issue | Location |
|--------|-------|----------|
| 🔴 Open | Logout endpoint not implemented | `auth.js:94-96` |
| 🟡 Workaround | Google token error handling (returns null) | `googleAuth.js` |
| 🟡 Workaround | CORS wildcard fallback | `server.js:20` |
| ✅ Resolved | Duplicate title prevention | MySQL UNIQUE constraint |
| ✅ Resolved | Multi-env database config | Env-based pool config |

---

## Dependencies

**Core:** Express 5.1.0, MySQL2 3.15.3, JWT 9.0.2, Google Auth Library 10.5.0  
**Files:** Multer 2.0.2, AWS SDK S3 3.966.0  
**Utilities:** CORS 2.8.5, Dotenv 17.2.3  
**Dev:** Jest 30.2.0, Supertest 7.1.4, Nodemon 3.1.11  

---

## Performance Notes

- Connection pooling (10 max) suitable for small-medium workload
- LEFT JOIN + in-app aggregation (not DB view)
- Multipart uploads streamed to R2 (not local storage)
- 2s dev delay middleware for latency simulation

---

## Summary

Well-structured **focused REST API** with:
- Clear separation of concerns (auth, routes, services)
- Role-based access control (admin flag)
- Multi-environment support
- Comprehensive image handling (R2, URLs, references)
- Proper error handling with standard HTTP codes

**Production-ready** with minor enhancements needed: rate limiting, logout implementation, Google error handling refinement.
