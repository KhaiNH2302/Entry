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
		print("[ERROR] getPaymentById failed for paymentId: " + paymentId + " | Exception: " + e);
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
	if (!payment || payment["current.phase"] !== "initial_kttc") {
		return;
	}

	try {
		lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
				"esdHTKTpaymentCostDivision",
				rec
		);
	} catch (ex) {
		print("[ERROR] handlePaymentCostDivisionAndAccountingSync failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
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
	if (!payment || payment["current.phase"] !== "initial_kttc") {
		return;
	}

	try {
		lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
				"esdHTKTpaymentInvoice",
				rec
		);
	} catch (ex) {
		print("[ERROR] syncPaymentEntryBySourceChange failed for ID: " + (rec["id"] || "") + " | Exception: " + ex);
	}
}


