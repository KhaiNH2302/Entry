/**
 * ScriptLibrary : triggers
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Database Triggers
 * Version      : 1.0.0
 * Chức năng:
 * - Khai báo và xử lý các trigger bắt sự kiện trước/sau khi lưu dữ liệu các bảng HTKT.
 * -----------------------------------------------------------------------------
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
