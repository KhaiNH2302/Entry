function run() {
	try {
		var input = vars['$L.file'];
		if (!input) return;

		var result;
		switch (input.name) {
			case "getListSupplierLedger":
				result = { success: true, data: getListSupplierLedger(input) };
				break;
			case "getListAccountsPayable":
				result = { success: true, data: getListAccountsPayable(input) };
				break;
			default:
				result = { success: false, error: 'Missing or invalid action "name"' };
		}

		input.queryReturn = JSON.stringify(result);
	} catch (e) {
		if (vars['$L.file']) {
			vars['$L.file'].queryReturn = JSON.stringify({
				success: false,
				error: "Gateway Error: " + e.toString()
			});
		}
	}
}

function getListSupplierLedger(input) {
	var params = parseInputParams(input);
	var vendorId = String(params.vendorId || "").trim();
	var contractId = String(params.contractId || "").trim();
	var currentPaymentId = String(params.paymentId || "").trim();

	if (!vendorId || !contractId) return [];

	var query =
			"SELECT " +
			"ai.request.id AS accounting_information_id, " +
			"ai.prepayment.id AS prepayment_id, " +
			"ai.amount AS advance_amount, " +
			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +
			"aip.status AS ogl_status " +
			"FROM esdHTKTaccountingInformation ai " +
			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (pe.ref.id = ai.prepayment.id " +
			'AND pe.entry.type = "PREPAYMENT") ' +
			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (aip.request.id = pe.accounting.request.id) " +
			'WHERE ai.sub.type = "TAM_UNG" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP"';

	var resultMap = {};
	var resultOrder = [];
	var file = null;

	try {
		file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rc = file.doSelect(query);

		while (rc == RC_SUCCESS) {
			var accountingInformationId = String(
					file["accounting_information_id"] || ""
			).trim();
			var prepaymentId = String(file["prepayment_id"] || "").trim();
			var advanceAmount = getNumberField(file, [
				"advance_amount",
				"ai.amount",
				"amount"
			]);
			var paymentEntryAmount = getNumberField(file, [
				"payment_entry_amount",
				"pe.amount"
			]);
			var entryPaymentId = String(file["entry_payment_id"] || "").trim();
			var oglStatus = String(file["ogl_status"] || "").trim().toLowerCase();
			var key = accountingInformationId + "|" + prepaymentId;

			if (!resultMap[key]) {
				resultMap[key] = {
					accounting_information_id: accountingInformationId,
					prepayment_id: prepaymentId,
					advance_amount: advanceAmount,
					occupied_amount: 0,
					refunded_amount: 0,
					remaining_amount: advanceAmount,
					current_refund_amount: 0
				};
				resultOrder.push(key);
			}

			var item = resultMap[key];
			item.occupied_amount += paymentEntryAmount;

			if (oglStatus === "completed") {
				item.refunded_amount += paymentEntryAmount;
			}

			if (currentPaymentId && entryPaymentId === currentPaymentId) {
				item.current_refund_amount += paymentEntryAmount;
			}

			rc = file.getNext();
		}
	} finally {
		closeSCFile(file);
	}

	var invoiceList = [];
	for (var i = 0; i < resultOrder.length; i++) {
		var resultItem = resultMap[resultOrder[i]];
		resultItem.remaining_amount =
				resultItem.advance_amount - resultItem.occupied_amount;
		if (resultItem.remaining_amount < 0) resultItem.remaining_amount = 0;
		invoiceList.push(resultItem);
	}

	return invoiceList;
}

function getListAccountsPayable(input) {
	var params = parseInputParams(input);
	var vendorId = String(params.vendorId || "").trim();
	var contractId = String(params.contractId || "").trim();
	var currentPaymentId = String(params.paymentId || "").trim();

	if (!vendorId || !contractId) return [];

	var query =
			"SELECT " +
			"ai.request.id AS accounting_information_id, " +
			"ai.prepayment.id AS prepayment_id, " +
			"ai.amount AS advance_amount, " +
			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +
			"aip.status AS ogl_status " +
			"FROM esdHTKTaccountingInformation ai " +
			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (pe.ref.id = ai.prepayment.id " +
			'AND pe.entry.type = "PAYABLE") ' +
			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (aip.request.id = pe.accounting.request.id) " +
			'WHERE ai.sub.type = "THANH_TOAN" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP"';

	var resultMap = {};
	var resultOrder = [];
	var file = null;

	try {
		file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rc = file.doSelect(query);

		while (rc == RC_SUCCESS) {
			var accountingInformationId = String(
					file["accounting_information_id"] || ""
			).trim();
			var prepaymentId = String(file["prepayment_id"] || "").trim();
			var advanceAmount = getNumberField(file, [
				"advance_amount",
				"ai.amount",
				"amount"
			]);
			var paymentEntryAmount = getNumberField(file, [
				"payment_entry_amount",
				"pe.amount"
			]);
			var entryPaymentId = String(file["entry_payment_id"] || "").trim();
			var oglStatus = String(file["ogl_status"] || "").trim().toLowerCase();
			var key = accountingInformationId + "|" + prepaymentId;

			if (!resultMap[key]) {
				resultMap[key] = {
					accounting_information_id: accountingInformationId,
					prepayment_id: prepaymentId,
					advance_amount: advanceAmount,
					occupied_amount: 0,
					refunded_amount: 0,
					remaining_amount: advanceAmount,
					current_refund_amount: 0
				};
				resultOrder.push(key);
			}

			var item = resultMap[key];
			item.occupied_amount += paymentEntryAmount;

			if (oglStatus === "completed") {
				item.refunded_amount += paymentEntryAmount;
			}

			if (currentPaymentId && entryPaymentId === currentPaymentId) {
				item.current_refund_amount += paymentEntryAmount;
			}

			rc = file.getNext();
		}
	} finally {
		closeSCFile(file);
	}

	var invoiceList = [];
	for (var i = 0; i < resultOrder.length; i++) {
		var resultItem = resultMap[resultOrder[i]];
		resultItem.remaining_amount =
				resultItem.advance_amount - resultItem.occupied_amount;
		if (resultItem.remaining_amount < 0) resultItem.remaining_amount = 0;
		invoiceList.push(resultItem);
	}

	return invoiceList;
}

function parseInputParams(input) {
	try {
		if (input.details) return JSON.parse(input.details);
		if (input.queryString) return JSON.parse(input.queryString);
	} catch (ignore) {}
	return {};
}

function getNumberField(file, fieldNames) {
	for (var i = 0; i < fieldNames.length; i++) {
		var value = file[fieldNames[i]];
		if (value !== null && value !== undefined && value !== "") {
			var numberValue = Number(value);
			if (!isNaN(numberValue)) return numberValue;
		}
	}
	return 0;
}

function escapeSmQueryValue(value) {
	return String(value || "")
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"');
}

function closeSCFile(file) {
	try {
		if (file) file.doClose();
	} catch (ignore) {}
}
