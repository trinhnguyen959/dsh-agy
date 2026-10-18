# dsh-agy (Branch: plugin)

Tool & Plugin tích hợp **model/quota Antigravity** vào **DeepSeek Harness (DSH)**.

Dự án hỗ trợ **cả 2 chế độ**:
1. **Chế độ Plugin DSH (Mới - Khuyên dùng):** DSH tự động nạp `dsh-agy` lúc khởi động thông qua Cordis Loader. Proxy tự chạy in-process, tự đóng khi DSH tắt — **hoàn toàn không cần mở file start.cmd nào cả**!
2. **Chế độ Standalone Daemon:** Chạy độc lập bằng `start.cmd` hoặc `pnpm start` như trước.

Dùng **model/quota Antigravity** trong **DeepSeek Harness (DSH)** qua một proxy OpenAI-compatible chạy local.

- Không cần mở Antigravity.
- Không có dependency runtime — chỉ cần **Node.js 18+** (khuyến nghị dùng **pnpm**).
- Không tự khởi động cùng Windows: mỗi lần dùng chạy `start.cmd`.

```
DSH (dsh-llm-pi-ai) ──/v1──▶ agy-proxy 127.0.0.1:8787 ──v1internal──▶ daily-cloudcode-pa.googleapis.com
                                  │
                                  └── credential: %USERPROFILE%\.agy-dsh\credential.json
```

## Dùng lần đầu

1. Copy thư mục này sang máy (hoặc clone).
2. Double-click **`start.cmd`**.
3. Trình duyệt mở trang đăng nhập Google → chọn account có Antigravity → đồng ý.
4. Script tự:
   - lưu credential vào `%USERPROFILE%\.agy-dsh\credential.json`;
   - thêm route `antigravity` vào `~/.dsh/profiles/*/cordis.patch.yml`;
   - thêm `AGY_PROXY_KEY` vào `~/.dsh/.credentials.yaml`;
   - chạy proxy tại `http://127.0.0.1:8787/v1`.
5. Trong DSH: mở model picker → **Antigravity (local)** → chọn `Gemini 3 Flash (AGY)` (hoặc Claude/GPT-OSS).

> Nếu DSH đang chạy trước khi cài: khởi động lại DSH một lần để nạp route. Sau đó chỉ cần chạy `start.cmd` là dùng.

## Các lệnh

| Lệnh | Việc |
|---|---|
| `start.cmd` | Đăng nhập (nếu chưa) → cấu hình DSH → chạy proxy |
| `stop.cmd` | Dừng proxy (theo cổng 8787) |
| `pnpm status` | Account, tier, quota còn lại, danh sách model |
| `pnpm login` | Đăng nhập lại / thêm account (ghi đè credential hiện tại) |
| `pnpm install-dsh` | Chỉ cấu hình DSH, không chạy proxy (`-- --dry-run` để xem trước) |
| `pnpm test` | Smoke test: chat, stream, tool call |

## pnpm

Project ghim `pnpm@10.34.7` qua `packageManager` và có `pnpm-lock.yaml` (lockfile 9.0). Corepack sẽ tự tải đúng bản pnpm khi chạy trong thư mục này. Không có dependency runtime,
nên `pnpm install` chỉ để đồng bộ lockfile:

```powershell
pnpm install      # tùy chọn, tạo/đồng bộ pnpm-lock.yaml
pnpm start        # = node start.mjs
pnpm status
pnpm test
pnpm login
pnpm install-dsh --dry-run
```

`start.cmd` tự dùng `pnpm start` nếu máy có pnpm, không có thì fallback `node start.mjs`
(nhờ vậy copy sang máy khác vẫn chạy được mà không cần cài gì).

## Cấu hình (biến môi trường)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `AGY_PORT` | `8787` | Cổng proxy |
| `AGY_HOME` | `%USERPROFILE%\.agy-dsh` | Nơi lưu credential |
| `AGY_CREDENTIAL` | — | Dùng file credential chỉ định (ghi đè `AGY_HOME`) |
| `AGY_BASE_URL` | `http://127.0.0.1:8787/v1` | URL ghi vào cấu hình DSH |
| `DSH_HOME` | `%USERPROFILE%\.dsh` | Thư mục DSH cần patch |

Ví dụ đổi cổng:

```powershell
set AGY_PORT=9000
start.cmd
```

## Cơ chế

- **OAuth**: luồng Authorization Code + PKCE, callback `http://localhost:51121/oauth-callback`, scope cloud-platform + userinfo. Refresh token được lưu và tự refresh khi hết hạn.
- **API**: `POST /v1internal:generateContent` và `streamGenerateContent?alt=sse` trên `daily-cloudcode-pa.googleapis.com`.
- **thoughtSignature**: Gemini 3 bắt buộc gửi lại chữ ký của `functionCall` khi replay lịch sử. Proxy nhét chữ ký vào `tool_call.id` dạng `<id>__<base64url(sig)>` rồi bóc ra — nhờ vậy tool calling qua DSH hoạt động.
- **Thinking**: part `thought: true` bị bỏ khỏi nội dung trả về.
- **Quota**: mỗi model trả `quotaInfo.remainingFraction`; `pnpm status` tổng hợp theo nhóm Google / Anthropic / OpenAI.

## Lưu ý

- Đây là **API nội bộ** của Antigravity, không phải API công khai — Google đổi là gãy.
- Dùng quota Antigravity cho công cụ ngoài **có thể vi phạm ToS và bị khóa account**. Tự cân nhắc.
- Free tier quota Google khá thấp; đừng dùng làm model chính cho task dài.
- Proxy phải đang chạy trước khi DSH gọi model.
- Credential nằm ngoài thư mục này (`%USERPROFILE%\.agy-dsh`) nên copy thư mục sang máy khác **không** mang theo token — máy mới sẽ yêu cầu đăng nhập lại (đúng ý).

## Xử lý sự cố

| Hiện tượng | Cách xử lý |
|---|---|
| `cổng 8787 đang bận` | Proxy đã chạy sẵn — dùng luôn, hoặc `stop.cmd` rồi chạy lại |
| `cổng 51121 đang bị chiếm` | Đóng app đang giữ cổng (thường là lần login cũ chưa thoát) rồi `pnpm login` |
| DSH không thấy Antigravity | Khởi động lại DSH; kiểm tra `pnpm install-dsh --dry-run` |
| 401/403 khi chat | `pnpm login` lại |
| 429 / quota | Hết quota — chờ reset hoặc thêm account khác |
| DSH lỗi lúc khởi động sau khi patch | Khôi phục file `.bak-<timestamp>` cạnh `cordis.patch.yml` |
