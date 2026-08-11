/**
 * =============================================================================
 * TRIGGERS - ĐỒNG BỘ BÚT TOÁN THANH TOÁN (PAYMENT ENTRY)
 * =============================================================================
 * File cấu hình các hàm gọi Trigger trong HP Service Manager (HPSM).
 * Toàn bộ logic nghiệp vụ, log và kiểm tra phase được đặt trong thư viện ESD_HTKT_PAYMENT_ENTRY.
 */

/**
 * Trigger trên bảng esdHTKTpaymentCostDivision (After Add, After Update, After Delete)
 */
function handlePaymentCostDivisionAndAccountingSync(rec) {
	lib.ESD_HTKT_PAYMENT_ENTRY.handlePaymentCostDivisionAndAccountingSync(rec);
}

/**
 * Trigger trên bảng esdHTKTpaymentInvoice (After Add, After Update, After Delete)
 */
function handleSyncPaymentEntryByInvoice(rec) {
	lib.ESD_HTKT_PAYMENT_ENTRY.handleSyncPaymentEntryByInvoice(rec);
}

/**
 * Trigger trên bảng esdHTKTpaymentVendor (After Add, After Delete)
 */
function handleSyncPaymentEntryByVendor(rec) {
	lib.ESD_HTKT_PAYMENT_ENTRY.handleSyncPaymentEntryByVendor(rec);
}

/**
 * Trigger trên bảng esdHTKTpaymentVendor (After Update)
 */
function handleUpdatePaymentVendorAndAccountingSync(rec, oldRec) {
	lib.ESD_HTKT_PAYMENT_ENTRY.handleUpdatePaymentVendorAndAccountingSync(rec, oldRec);
}
