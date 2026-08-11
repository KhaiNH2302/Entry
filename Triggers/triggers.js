var logger = getLog("ESD_HTKT_PAYMENT_ENTRY");
/**
 * Lấy thông tin bản ghi payment từ bảng esdHTKTpayment theo paymentId
 */
function getPaymentById(paymentId) {
	if (!paymentId) {
		return null;
	}

	var file = null;
	var payment = null;
	try {
		file = new SCFile("esdHTKTpayment", SCFILE_READONLY);
		var rc = file.doSelect('id="' + paymentId + '"');
		if (rc === RC_SUCCESS) {
			payment = {
				"id": file["id"],
				"current.phase": file["current.phase"]
			};
		}
	} catch (e) {
		logger.info("getPaymentById failed for paymentId: " + paymentId + " | Exception: " + e);
	} finally {
		if (file) {
			try {
				file.doClose();
			} catch (ignoreClose) {}
		}
	}
	return payment;
}

/**
 * Chỉ chạy khi record Payment ở Phase 'initial_kttc'
 */
function handlePaymentCostDivisionAndAccountingSync(rec) {
	if (!rec) {
		return;
	}

	var paymentId = rec["payment.id"] || rec["id"];
	if (!paymentId) {
		return;
	}

	var payment = lib.ESD_HTKT_PAYMENT_COMMON.getPaymentById(paymentId);
	logger.info("handlePaymentCostDivisionAndAccountingSync | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

	if (!payment || payment["current.phase"] !== "initial_kttc") {
		return;
	}

	try {
		lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
				"esdHTKTpaymentCostDivision",
				rec
		);
	} catch (ex) {
		logger.info("handlePaymentCostDivisionAndAccountingSync failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
	}
}

/**
 * Chỉ chạy khi record Payment ở Phase 'initial_kttc'
 */
function handleSyncPaymentEntryByInvoice(rec) {
	if (!rec) {
		return;
	}

	var paymentId = rec["payment.id"] || rec["id"];
	if (!paymentId) {
		return;
	}

	var payment = lib.ESD_HTKT_PAYMENT_COMMON.getPaymentById(paymentId);
	logger.info("handleSyncPaymentEntryByInvoice | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

	if (!payment || payment["current.phase"] !== "initial_kttc") {
		return;
	}

	try {
		lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
				"esdHTKTpaymentInvoice",
				rec
		);
	} catch (ex) {
		logger.info("handleSyncPaymentEntryByInvoice failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
	}
}

/**
 * Hàm đồng bộ bút toán Payment Entry từ sự thay đổi của Payment Vendor
 * Chỉ thực thi khi record ở Phase 'initial_kttc'
 */
function handleSyncPaymentEntryByVendor(rec) {
	if (!rec) {
		return;
	}

	var paymentId = rec["payment.id"] || rec["id"];
	if (!paymentId) {
		return;
	}

	var payment = lib.ESD_HTKT_PAYMENT_COMMON.getPaymentById(paymentId);
	logger.info("handleSyncPaymentEntryByVendor | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

	if (!payment || payment["current.phase"] !== "initial_kttc") {
		return;
	}

	try {
		lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
				"esdHTKTpaymentVendor",
				rec
		);
	} catch (ex) {
		logger.info("handleSyncPaymentEntryByVendor failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
	}
}

/**
 * Hàm điều phối cập nhật tổng tiền ĐNTT và đồng bộ bút toán
 * Chỉ chạy khi record ở Phase 'initial_kttc'
 */
function handleUpdatePaymentVendorAndAccountingSync(rec, oldRec) {
	lib.ESD_HTKT_PAYMENT_VENDOR.handleVendorChangeUpdate(rec);
	if (!rec) {
		return;
	}

	var paymentId = rec["payment.id"] || rec["id"];
	if (!paymentId) {
		return;
	}

	var payment = lib.ESD_HTKT_PAYMENT_COMMON.getPaymentById(paymentId);
	logger.info("handleUpdatePaymentVendorAndAccountingSync | paymentId: " + paymentId + " | payment: " + (payment ? JSON.stringify(payment) : payment));

	if (!payment || payment["current.phase"] !== "initial_kttc") {
		return;
	}

	try {
		lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
				"esdHTKTpaymentVendor",
				rec
		);
	} catch (ex) {
		logger.info("handleUpdatePaymentVendorAndAccountingSync failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
	}
}
