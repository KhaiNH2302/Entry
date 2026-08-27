# Context hiện tại - Sinh bút toán thanh toán

Cập nhật ngày: 26/08/2026

## 1. Nguồn quy tắc ưu tiên

- **Bảng quyết định** là nguồn quy tắc ưu tiên cao nhất.
- Nếu nội dung mô tả chi tiết khác Bảng quyết định, áp dụng theo Bảng quyết định.
- Đã loại bỏ hoàn toàn điều kiện `(2) + (3) < (1)` khỏi code và tài liệu liên quan.

Quy ước số tiền:

- `(1)` = `paymentVendor.approved.invoice.amount`
- `(2)` = `paymentVendor.amount`
- `(3)` = `paymentVendor.refund.amount`

## 2. Nguyên tắc phân case

### Case sinh từ dữ liệu nguồn

- Các case tự xác định ban đầu: TT-01 đến TT-13 và TT-17.
- TT-11, TT-12, TT-13:
  - `(3) > 0`
  - `(2) = 0`
  - `(1) != (3)`
  - Không tự sinh dòng Có; kế toán tự thêm dòng cần thiết.

### Case cơ bản và case đặc biệt

TT-08, TT-09, TT-10 là case cơ bản khi `(3) > 0` và `(2) > 0`:

| Case cơ bản | Phân biệt |
|---|---|
| TT-08 | Không thuế |
| TT-09 | Có thuế, NCC |
| TT-10 | Cá nhân |

TT-14, TT-15, TT-16 là trạng thái đặc biệt sau tác động của kế toán:

| Case cơ bản | Sau tác động người dùng |
|---|---|
| TT-08 | TT-14 |
| TT-09 | TT-15 |
| TT-10 | TT-16 |

Code luôn xác định TT-08/09/10 trước, sau đó mới chuyển sang TT-14/15/16 nếu có tác động người dùng. TT-14/15/16 không được xuất hiện như case khởi tạo độc lập.

## 3. Tác động của người dùng

Một NCC được coi là đã có tác động của kế toán khi tồn tại ít nhất một trong ba dạng dòng:

- `type = AP`, `entry_type = PREPAYMENT`
- `type = AP`, `entry_type = PAYABLE` và là dòng thủ công
- `type = GL`

Dòng AP do người dùng thêm mới được cấp ID dạng:

```text
<paymentId>.MANUAL.AP.<sequence>
```

Mục đích:

- Phân biệt PAYABLE thủ công với PAYABLE tự sinh của TT-08/09/10.
- Giữ dòng thủ công khi đồng bộ/sinh lại bút toán.
- AP/PREPAYMENT và GL cũng được giữ khi đồng bộ.

## 4. Quy tắc sinh dòng Có

- TT-01, TT-03: tự sinh TRANSFER (Có TK KH). Không sinh LIABILITY vì `(1) = (2)`.
- TT-04, TT-05, TT-06: tự sinh TRANSFER (Có TK KH) nhưng **không tự sinh LIABILITY** (Có 331). Kế toán tự thêm dòng phải trả bằng thao tác thủ công.
- TT-07, TT-08, TT-09, TT-10: tự sinh TRANSFER (Có TK KH nếu `(2) > 0`) **và** LIABILITY (Có 331) cho phần chênh lệch `(1) - (2)`.
  - TT-10 (cá nhân): số tiền các dòng Có để trống, kế toán tự nhập.
- TT-11, TT-12, TT-13: không tự sinh bất kỳ dòng ghi Có nào (`accountingCreatesCredit`).
- TT-14, TT-15, TT-16: tự sinh TRANSFER (Có TK KH) nhưng **không sinh LIABILITY** (`accountingCreatesCredit` chặn sau TRANSFER).
  - TT-16 (cá nhân): số tiền TRANSFER để trống.
- TT-17: sinh Nợ PAYABLE và Có CUSTOMER; không liên quan TRANSFER/LIABILITY.
- Khi chuyển từ TT-08/09/10 sang TT-14/15/16, code bảo toàn các dòng do người dùng thêm và sinh lại các phần tự động (bao gồm cả TRANSFER).

## 5. Validation Vendor Site

### `credit.account`

- Không còn bắt buộc `credit.account` ở cấp NCC cho mọi case.
- Nếu một dòng tự sinh thực tế cần tài khoản phải trả, validation cấp dòng mới kiểm tra `credit.account`.
- TT-11 đến TT-16 không bị chặn chỉ vì thiếu `credit.account`.

### `ogl.site.code`

- Không dùng để tính case hoặc sinh `paymentEntry`.
- Không còn chặn bước sinh bút toán.
- Được map thành `vendorSiteCode` và kiểm tra tại bước tạo `accountingInformation`/gọi API `/ap/create-invoice`.

## 6. Vấn đề Vendor Site hiện tại

Dữ liệu đã kiểm tra:

- `paymentVendor.vendor.site.id = 0000000222`
- Bản ghi `esdHTKTvendorSite` trong ảnh có:
  - `id = 0000000246`
  - `vendor.id = 0000000040`
  - `ogl.site.code = 126150610`

Đây là liên kết ID không khớp, không phải trường `ogl.site.code` bị rỗng.

Code cũ chỉ query:

```text
esdHTKTvendorSite.id = paymentVendor.vendor.site.id
```

Code hiện tại xử lý theo thứ tự:

1. Tìm chính xác theo Vendor Site ID.
2. So sánh ID sau khi chuẩn hóa số 0 đầu.
3. Nếu NCC chỉ có đúng một Vendor Site, dùng Site duy nhất đó và ghi warning.
4. Nếu NCC có nhiều Vendor Site, không tự đoán.

Cách sửa dữ liệu chuẩn vẫn là cập nhật:

```text
paymentVendor.vendor.site.id = 0000000246
```

## 7. Dữ liệu case đã phân tích

### Payment `TT.106.26.1500000`

- `(1) = 450000`
- `(2) = 50000`
- `(3) = 300000`
- Có thuế, NCC doanh nghiệp.
- Nếu chưa có tác động người dùng: TT-09.
- Nếu có AP/PREPAYMENT, AP/PAYABLE thủ công hoặc GL: TT-15.

### Payment `TT.106.26.0300000`

- `(1) = 400000`
- `(2) = 0`
- `(3) = 0`
- Có thuế, NCC doanh nghiệp.
- Theo dữ liệu `paymentVendor`, case là TT-06, không phải TT-03.
- Muốn TT-03 thì `(1) = (2)`; `paymentVendor.amount` phải bằng `400000`.
- `payment.total.amount.paid` không được dùng để phân case.

## 8. File code chính

- `Code Bút toán/Tự động sinh và đồng bộ bút toán thanh toán trong esdHTKTpaymentEntry.js`
- `Code Bút toán/Tự động sinh và kiểm thử bút toán thanh toán bằng object.js`
- `Code JS hỗ trợ/check_data_sinh_but_toan_by_payment_id.js`
- `Kết quả hạch toán/Thanh toán/ESD_HTKT_PAYMENT_ACCOUNTING_INFORMATION.js`

## 9. Trạng thái kiểm thử

- Kiểm tra cú pháp mã chính: đạt.
- Kiểm tra cú pháp script check data: đạt.
- Bộ regression: 18/18 case đạt.
- Kiểm thử tài khoản chi phí cá nhân: 2/2 đạt.
- Kiểm thử thuế khấu trừ theo tỷ lệ: 2/2 đạt.

## 10. Lưu ý triển khai

- Nếu JSON trên môi trường vẫn báo bắt buộc `credit.account` hoặc `ogl.site.code` tại `BUILD-VENDOR-ERROR`, môi trường đang chạy bản script cũ.
- Cần triển khai đồng thời mã chạy, script check data và các phần mapping liên quan.
- Dòng thủ công cũ chưa có ID `.MANUAL.AP.` có thể cần xóa/thêm lại để được nhận diện chắc chắn là hành động người dùng.

## 11. AccountingInformation cho Payment

### Phạm vi và nguồn dữ liệu

- Chỉ xử lý Payment; không dùng bảng Tạm ứng làm nguồn nghiệp vụ.
- Nguồn chính:
  - `esdHTKTpayment`
  - `esdHTKTpaymentVendor`
  - `esdHTKTpaymentEntry`
  - `esdHTKTpaymentInvoice`
  - `esdHTKTinvoice`
  - danh mục NCC, Vendor Site, Contact và Entity liên quan.
- Bảng đích là `esdHTKTaccountingInformation`, liên kết bằng `payment.id`.
- File preview chỉ đọc và `print` JSON; không insert/update/delete.
- Mọi `SCFile` phải được đóng bằng `doClose()` trong `finally`.

### Mapping người tạo, người kiểm tra và đơn vị

- `maker = payment.created.by`.
- `checker = payment.user.checker.kttc`.
- Không phân nhánh maker/checker theo `initial.role`.
- Không fallback sang `user.approver.final` hoặc `user.approver.kttc`.
- Mapping Entity/Segment 1 của người tạo:

```text
payment.created.by
→ contacts.contact.name
→ contacts.lv1.id
→ esdDMentity.ps.code (giữ nguyên lv1.id, không cắt số 0)
→ esdDMentity.entity.code
```

- Không tự biến đổi `contacts.lv1.id` nếu tài liệu/code chuẩn không quy định.

### Ma trận API TT-01 đến TT-17

- TT-01 đến TT-16: một payload `/ap/create-invoice` cho mỗi NCC.
- TT-02, TT-05, TT-10, TT-13, TT-16: có thêm payload `/general-ledger/interface` khi KT đã nhập các dòng GL.
- TT-17: dùng `/ap/create-payment` (bản ghi `esdHTKTaccountingInformation` có `sub.type = 'TAT_TOAN'`, hiển thị nhãn `AP-Payment`); bắt buộc dòng PAYABLE ghi Nợ có `paymentEntry.ref.id` là mã YCTT cũ.
- Dòng AP/PREPAYMENT và PAYABLE ghi Nợ trả khoản cũ được đưa vào `applyList` với:
  - `invoiceNumber = paymentEntry.ref.id`
  - `amount = paymentEntry.amount`
- Dòng AP/PAYABLE ghi Có (nếu có) cung cấp `liabilityAccount`.
- `liabilityAccount` không bắt buộc nếu không phát sinh giữ lại phải trả.
- Chuyển khoản sinh thêm CORE từ dòng AP/CUSTOMER ghi Có; phân loại `INHOUSE` hoặc `CITAD` theo mã Napas.
- Tiền mặt không sinh CORE.

### Số tiền AP

- NCC thông thường:
  - `amount = paymentVendor.approved.invoice.amount`
  - `amountPay = paymentVendor.amount`
- NCC cá nhân:
  - `amount` lấy tổng các dòng COST/TAX thuộc AP sau khi KT nhập số tiền thực tế.
  - `amountPay` lấy tổng dòng AP/CUSTOMER ghi Có sau khi KT nhập số tiền thực tế.
- Không dùng số tiền GL TNCN để cộng vào AP invoice.

### Validation đúng tầng

- `credit.account` và `ogl.site.code` không dùng để phân case và không chặn toàn bộ bước sinh `paymentEntry`.
- Dòng tự sinh thực sự cần tài khoản phải trả vẫn validation `credit.account` ở cấp dòng.
- Khi dựng `/ap/create-invoice`, `vendorSiteCode` là bắt buộc và lấy từ `vendorSite.ogl.site.code`.
- Thiếu `ogl.site.code` phải báo tại validation payload AP (`missingFields: ["vendorSiteCode"]`), không chặn sớm trong context.
- `/ap/create-payment` của TT-17 không yêu cầu `vendorSiteCode`, nên không được chặn vì thiếu trường này.
- `entity` bắt buộc cho cả `/ap/create-invoice` và `/ap/create-payment`; thiếu mapping người tạo/Entity phải báo lỗi mapping.
- `liabilityAccount` được phép trống khi không có dòng PAYABLE ghi Có.

### Cấu trúc và validation payload OGL

- `invoiceLineList` gồm các dòng AP/COST và AP/TAX ghi Nợ.
- `applyList` gồm các giao dịch tạm ứng/phải trả cũ được chọn tại tab Công nợ.
- `vatList` lấy hóa đơn của đúng NCC; phiếu nhiều NCC phải khớp `invoice.seller.tax.code` với `vendor.vendor.number`.
- `cashout`: Tiền mặt = `Y`, Chuyển khoản = `N`; giá trị khác phải báo lỗi, không tự mặc định.
- Độ dài segment theo đặc tả:
  - segment1: 7
  - segment2: 6
  - segment3: 9
  - segment4/5/6/7: 7
- GL map `segment1`/`segment6` theo quy tắc của Tạm ứng bằng `org.transaction.code + ogl.branch.code → entity.code`; không dùng thẳng mã giao dịch làm segment.

## 12. Nguyên tắc không tự suy diễn

- Ưu tiên theo thứ tự: Bảng quyết định → Đặc tả tích hợp OGL → Các trường hợp hạch toán thanh toán → code Tạm ứng đã được chốt.
- Không tự thêm fallback giữa các trường dữ liệu có ý nghĩa nghiệp vụ khác nhau.
- Không tự cắt số 0, đổi mã, gán mặc định hoặc dùng một trường thay trường khác nếu chưa có quy tắc rõ ràng.
- Khi tài liệu mâu thuẫn, dừng tại validation và ghi rõ trường cần chốt; không âm thầm chọn một cách hiểu.
- Giá trị hard-code chỉ được giữ khi đã tồn tại trong code chuẩn/tài liệu và phải có chú thích nguồn.
- Mọi thay đổi mapping phải kèm kiểm thử preview/read-only trước khi dùng chế độ ghi DB.

## 13. Trạng thái kiểm thử AccountingInformation Payment

- Ma trận OGL TT-01 đến TT-17: 17/17 case đạt.
- Năm case cá nhân TT-02/05/10/13/16: AP + GL đạt khi có đủ dòng GL do KT nhập.
- ApplyPrepayment/khoản phải trả cũ: đã kiểm tra có `applyList`.
- TT-17: đã kiểm tra payload `/ap/create-payment` và bắt buộc `ref.id`.
- CORE: `INHOUSE` và `CITAD` đều đạt.
- Preview read-only: không gọi insert/update/delete.

## 14. Hệ thống Gửi Email & Kế hoạch Phân hệ Thanh toán

### Hiện trạng các phân hệ đã có
- **YCBG / HSYC** (`ESD_MS_YCBG_ACTION_WF.js`, `ESD_MS_YCBG_ACTION_WF_SendEmail.js`):
  - RuleSet: `ESD_MS_YCBG_SENDEMAIL`
  - Template: `TEM014` (Yêu cầu xác nhận), `TEM015` (Yêu cầu duyệt), `TEM016` (Xác nhận), `TEM017` (Yêu cầu chỉnh sửa), `TEM018` (Phê duyệt).
- **Hợp đồng / Triển khai / Nghiệm thu** (`ESD_HD_ACTION_WF_SEND_EMAIL.js`, `ESD_HD_CONTRACT_SENDEMAIL.js`):
  - Quy tắc gửi RuleSet: `ESD_HD_CONTRACT_SENDEMAIL_TEMPxx`.
  - Quản lý hơn 20 mẫu email cảnh báo (TEMP01-04, TEMP29), nghiệm thu (TEMP09, TEMP12-16), kho/tài sản (TEMP05-08, TEMP10-11), triển khai (TEMP17-20, TEMP27-28, TEMP31).
  - Sử dụng các hàm tính hạn: `getDaysUntil`, `getDaysBetween`, `isReminderDue`.

### Khởi tạo cho Phân hệ Thanh toán (Payment)
- **Workflow tương ứng**: `ESD_HTKT_PAYMENT_WF` (`WF/PAYMENT_WF.js`)
- **Tài liệu đặc tả riêng**: `Gửi Email/Thanh toán/README.md`
- **Thư viện script gửi email**: `Gửi Email/Thanh toán/ESD_HTKT_PAYMENT_WF_SendEmail.js`
- **RuleSet dự kiến**: `ESD_HTKT_PAYMENT_SENDEMAIL`
- **Template dự kiến**:
  - `TEM_TT01`: Yêu cầu rà soát / phê duyệt / tiếp nhận hồ sơ thanh toán theo phase.
  - `TEM_TT02`: Yêu cầu chỉnh sửa / trả về hồ sơ thanh toán (`returnToUpdate`).
  - `TEM_TT03`: Thông báo hồ sơ thanh toán đã phê duyệt / ký số hoàn tất (`approval_final`).
  - `TEM_TT04`: Thông báo hoàn thành hạch toán / chi tiền (`accounted`).
  - `TEM_TT05`: Cảnh báo sắp đến hạn thanh toán.
- **Nguyên tắc kỹ thuật**: Mọi hàm gửi mail phải bọc trong `try/finally` và gọi `cleanGlobalVariable()` để giải phóng `$G.mail.receiver`, `$G.mail.receiver.name`, `$G.mail.tem`.

