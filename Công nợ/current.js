var logger = typeof getLog === 'function' ? getLog("ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST") : { info: function(m) { debugPaymentEntry('INFO', m); }, error: function(m) { debugPaymentEntry('ERROR', m); } };


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
			case 'saveListPaymentEntryRefund':
				var data = saveListPaymentEntryRefund(input);
				result = { success: true, data: data };
				break;
			case 'saveListPaymentEntryPayable':
				var data = saveListPaymentEntryPayable(input);
				result = { success: true, data: data };
				break;
			case "getCurrentPaymentSummary":
				result = { success: true, data: getCurrentPaymentSummary(input) };
				break;
			case "getSupplierDebtSummary":
				result = { success: true, data: getSupplierDebtSummary(input) };
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
			"ai.request.id AS requestId, " +
			"ai.prepayment.id AS prepaymentId, " +
			"ai.vendor.id AS vendorId, " +
			"ai.type AS type, " +
			"ai.status AS status, " +
			"ai.message AS message, " +
			"ai.response AS response, " +
			"ai.transaction.id AS transactionId, " +
			"ai.ap.code AS apCode, " +
			"ai.checked.time AS checkedTime, " +
			"ai.sub.type AS subType, " +
			"ai.amount AS advance_amount, " +
			"ai.contract.id AS contractId, " +

			"ai.data AS ai_data, " + // Để lấy currency

			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +

			"pe.description AS pe_description, " +

			"aip.status AS ogl_status " +

			"FROM esdHTKTaccountingInformation ai " +

			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (ai.prepayment.id = pe.ref.id  " +
			'AND pe.entry.type = "PREPAYMENT") ' +

			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (pe.accounting.request.id = aip.request.id ) " +


			'WHERE ai.sub.type = "TAM_UNG" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP" ' +
			'ORDER BY ai.checked.time DESC'; // Sắp xếp ngày hạch toán mới nhất

	var resultMap = {};
	var resultOrder = [];
	var file = null;

	try {
		file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rc = file.doSelect(query);

		while (rc == RC_SUCCESS) {
			var accountingInformationId = String(file["requestId"] || "").trim();
			var prepaymentId = String(file["prepaymentId"] || "").trim();
			var advanceAmount = getNumberField(file, ["advance_amount", "ai.amount", "amount"]);
			var paymentEntryAmount = getNumberField(file, ["payment_entry_amount", "pe.amount"]);

			var entryPaymentId = String(file["pe.payment.id"] || "").trim();
			var oglStatus = String(file["aip.status"] || "").trim().toLowerCase();
			var peDescription = String(file["pe.description"] || "").trim(); // Lấy description từ payment entry

			var key = accountingInformationId + "|" + prepaymentId;

			if (!resultMap[key]) {
				resultMap[key] = {
					requestId: accountingInformationId,
					prepaymentId: prepaymentId,
					vendorId: String(file["vendorId"] || "").trim(),
					type: String(file["type"] || "").trim(),
					status: String(file["status"] || "").trim(),
					message: String(file["message"] || "").trim(),
					response: String(file["response"] || "").trim(),
					transactionId: String(file["transactionId"] || "").trim(),
					apCode: String(file["ap.code"] || file["apCode"] || ""),
					checkedTime: file["checkedTime"] || "",
					subType: String(file["subType"] || "").trim(),
					amount: advanceAmount,
					contractId: String(file["contractId"] || "").trim(),
					description: "", // Khởi tạo description của đề nghị lần này
					// Các biến khởi tạo tính toán
					advance_amount: advanceAmount,
					refunded_amount: 0, // Số tiền đã hoàn ứng (đã hạch toán xong và không thuộc ĐNTT hiện tại)
					other_pending_amount: 0, // Số tiền chờ duyệt ở các ĐNTT khác
					current_refund_amount: 0, // Số tiền hoàn ứng lần này (của ĐNTT hiện tại)
					//Các biến lấy từ cột data bảng esdHTKTaccountingInformation
					currency: ""
				};

				var rawData = file["ai_data"] || file["data"];
				if (rawData) {
					try {
						var parsedData = JSON.parse(rawData);
						resultMap[key].currency = parsedData.currency || String(file["currency"] || "").trim();
					} catch (e) {
						print("[DEBUG run] Error parsing column 'data': " + e);
						resultMap[key].currency = String(file["currency"] || "").trim();
					}
				} else {
					resultMap[key].currency = String(file["currency"] || "").trim();
				}


				resultOrder.push(key);
			}

			var item = resultMap[key];

			if (paymentEntryAmount > 0) {
				// 1. Cứ COMPLETED là tính vào "Số tiền đã hoàn ứng" (Không quan tâm phiếu nào)
				if (oglStatus === "completed") {
					item.refunded_amount += paymentEntryAmount;
				};
				// 2. Nếu thuộc Phiếu hiện tại -> "Số tiền hoàn ứng lần này"
				if (currentPaymentId && entryPaymentId === currentPaymentId) {
					item.current_refund_amount += paymentEntryAmount;
					if (peDescription) {
						item.description = peDescription; // Gán description từ payment entry của đề nghị hiện tại
					}
				}
				// 3. Nếu CHƯA Completed mà thuộc Phiếu khác (và không bị Hủy/Từ chối) -> "Chờ duyệt ở ĐNTT khác"
				else if (oglStatus !== "rejected" && oglStatus !== "cancelled" && oglStatus !== "failed") {
					if (entryPaymentId) {
						item.other_pending_amount += paymentEntryAmount;
					}
				}
			}

			rc = file.getNext();
		}
	} finally {
		closeSCFile(file);
	}

	// Tính toán lại remaining_amount và xuất ra danh sách
	var itemList = [];
	for (var i = 0; i < resultOrder.length; i++) {
		var resultItem = resultMap[resultOrder[i]];

		// Công thức chuẩn theo tài liệu:
		// Còn lại = Số tiền tạm ứng - Đã hoàn ứng - Hoàn ứng chờ duyệt trên các ĐNTT khác
		resultItem.remaining_amount = resultItem.advance_amount - resultItem.refunded_amount - resultItem.other_pending_amount;

		if (resultItem.remaining_amount < 0) resultItem.remaining_amount = 0;

		itemList.push(resultItem);
	}

	return itemList;
}



// Danh sách nợ phải trả của NCC
function getListAccountsPayable(input) {
	var params = parseInputParams(input);
	var vendorId = String(params.vendorId || "").trim();
	var contractId = String(params.contractId || "").trim();
	var currentPaymentId = String(params.paymentId || "").trim();

	if (!vendorId || !contractId) return [];

	var query =
			"SELECT " +
			"ai.request.id AS requestId, " +
			"ai.prepayment.id AS prepaymentId, " +
			"ai.vendor.id AS vendorId, " +
			"ai.type AS type, " +
			"ai.status AS status, " +
			"ai.message AS message, " +
			"ai.response AS response, " +
			"ai.transaction.id AS transactionId, " +
			"ai.ap.code AS apCode, " +
			"ai.checked.time AS checkedTime, " +
			"ai.sub.type AS subType, " +
			"ai.amount AS advance_amount, " +
			"ai.contract.id AS contractId, " +
			"ai.data AS ai_data, " +// Để lấy currency

			"currentEntry.amount AS current_payment_entry_amount, " +
			"currentEntry.id AS current_payment_entry_id, " +
			"currentEntry.description, " +

			"pv.approved.invoice.amount, " +
			"pv.amount, " +
			"pv.refund.amount " +

			"FROM esdHTKTaccountingInformation ai " +
			"JOIN esdHTKTpaymentEntry pe " +
			"ON (ai.prepayment.id = pe.payment.id " +
			'AND pe.entry.type = "PAYABLE" ' +
			'AND pe.account.type = "ASSET") ' +
			"JOIN esdHTKTpaymentVendor pv " +
			"ON (pv.payment.id = pe.payment.id " +
			'AND pv.vendor.id = "' + escapeSmQueryValue(vendorId) + '") ' +
			"LEFT JOIN esdHTKTpaymentEntry currentEntry " +
			"ON (ai.prepayment.id = currentEntry.ref.id " +
			'AND currentEntry.payment.id = "' + escapeSmQueryValue(currentPaymentId) + '" ' +
			'AND currentEntry.entry.type = "PAYABLE" ' +
			'AND currentEntry.account.type = "DEBIT") ' +
			'WHERE ai.sub.type = "THANH_TOAN" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP" ' +
			'AND ai.prepayment.id ~= "' + escapeSmQueryValue(currentPaymentId) + '" ' +
			'ORDER BY ai.checked.time DESC'; // Sắp xếp ngày hạch toán mới nhất


	var itemList = [];
	var file = null;

	try {
		file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rc = file.doSelect(query);

		while (rc == RC_SUCCESS) {
			var accountingInformationId = String(file["requestId"] || "").trim();
			var prepaymentId = String(file["prepaymentId"] || "").trim();
			var advanceAmount = getNumberField(file, ["advance_amount", "ai.amount", "amount"]);
			var currentPaymentEntryAmount = getNumberField(file, ["current_payment_entry_amount", "currentEntry.amount"]);
			var currentPaymentEntryDescription = String(file["currentEntry.description"] || "").trim();
			var peDescription = String(file["pe_description"] || "").trim(); // Lấy description từ payment entry

			var approvedInvoiceAmount = getNumberField(file, ["pv.approved.invoice.amount"]);
			var refundAmount = getNumberField(file, ["pv.refund.amount"]);
			var paidAmount = getNumberField(file, ["pv.amount"]);

			var item = {
				requestId: accountingInformationId,
				prepaymentId: prepaymentId,
				vendorId: String(file["vendorId"] || "").trim(),
				type: String(file["type"] || "").trim(),
				status: String(file["status"] || "").trim(),
				message: String(file["message"] || "").trim(),
				response: String(file["response"] || "").trim(),
				transactionId: String(file["transactionId"] || "").trim(),
				apCode: String(file["ap.code"] || file["apCode"] || ""),
				checkedTime: file["checkedTime"] || "",
				subType: String(file["subType"] || "").trim(),
				amount: advanceAmount,
				contractId: String(file["contractId"] || "").trim(),
				description: currentPaymentEntryDescription,           // Nội dung diễn giải của đề nghị lần này
				id: String(file["currentEntry.id"] || "").trim(),
				totalTax: 0, // Cot thue - chua biet lay o dau
				advance_amount: advanceAmount, //Số tiền thanh toán sau thuế
				totalAmountPaid: approvedInvoiceAmount - refundAmount - paidAmount,        // Số tiền đã hoàn thanh toán (đã hạch toán xong và không thuộc ĐNTT hiện tại)
				other_pending_amount: 0,   // Số tiền chờ duyệt ở các ĐNTT khác
				currentPaymentAmount: currentPaymentEntryAmount,   // Số tiền thanh toán lần này (của ĐNTT hiện tại)
				currency: ""
			};

			var rawData = file["ai_data"] || file["data"];
			if (rawData) {
				try {
					var parsedData = JSON.parse(rawData);
					item.currency = parsedData.currency || String(file["currency"] || "").trim();
				} catch (e) {
					print("[DEBUG run] Error parsing column 'data': " + e);
					item.currency = String(file["currency"] || "").trim();
				}
			} else {
				item.currency = String(file["currency"] || "").trim();
			}

			item.remaining_amount =
					item.advance_amount - item.paid_amount - item.other_pending_amount;
			if (item.remaining_amount < 0) item.remaining_amount = 0;

			itemList.push(item);
			rc = file.getNext();
		}
	} finally {
		closeSCFile(file);
	}

	return itemList;
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


// Xu ly them moi hoan ung o tab cong no
function saveListPaymentEntryRefund(input) {
	var rawDetails = "";

	print("[PAYMENT_ENTRY_REFUND] input=" + input);


	if (input.esdHTKTlistPaymentVendor && input.esdHTKTlistPaymentVendor.details) {
		rawDetails = input.esdHTKTlistPaymentVendor.details;
	} else if (input.details) {
		rawDetails = input.details;
	} else if (input.queryString) {
		try {
			var parsedQuery = JSON.parse(input.queryString);
			if (parsedQuery.esdHTKTlistPaymentVendor && parsedQuery.esdHTKTlistPaymentVendor.details) {
				rawDetails = parsedQuery.esdHTKTlistPaymentVendor.details;
			} else {
				rawDetails = parsedQuery.details || input.queryString;
			}
		} catch (e) {
			rawDetails = input.queryString;
		}
	}

	print("[PAYMENT_ENTRY_REFUND] rawDetails=" + rawDetails);

	if (!rawDetails) {
		return { success: false, message: "Thiếu dữ liệu chi tiết" };
	}

	try {
		var parsedData = JSON.parse(rawDetails);
		var dataObj = [];

		print("[PAYMENT_ENTRY_REFUND] parsedData=" + JSON.stringify(parsedData));

		if (parsedData.dataFromPopup && Array.isArray(parsedData.dataFromPopup)) {
			dataObj = parsedData.dataFromPopup;
		} else if (Array.isArray(parsedData)) {
			dataObj = parsedData;
		} else {
			return { success: false, message: "Dữ liệu không đúng định dạng danh sách (Array)" };
		}

		print("[PAYMENT_ENTRY_REFUND] dataObj.length=" + dataObj.length);

		if (dataObj.length === 0) {
			return { success: false, message: "Danh sách trống" };
		}

		var updatedIds = [];
		var addedIds = [];
		var deletedIds = [];
		var failedIds = [];
		var affectedPaymentIds = {};

		for (var i = 0; i < dataObj.length; i++) {
			var feeData = dataObj[i];

			var paymentId = feeData['paymentId'] || "";
			var vendorId = feeData['vendorId'] || "";
			var currentRefund = Number(feeData['currentRefund']) || 0;
			var currency = feeData['currency'] || "";
			var description = feeData['description'] || "";
			var refId = feeData['prepaymentId'] || "";
			var apCode = feeData['apCode'];

			if (paymentId === "" || vendorId === "") {
				print("Bỏ qua dòng số " + (i + 1) + " do thiếu thông tin paymentId hoặc vendorId");
				failedIds.push(paymentId || ("dòng " + (i + 1)));
				continue;
			}

			var entryFile = new SCFile("esdHTKTpaymentEntry");
			var query = "payment.id=\"" + paymentId + "\" AND vendor.id=\"" + vendorId + "\" AND ref.id=\"" + refId + "\"";

			var rcEntry = entryFile.doSelect(query);

			if (currentRefund <= 0) {
				// Nếu số tiền hoàn ứng lần này = 0 thì không sinh bút toán.
				// Nếu trước đó đã tồn tại dòng bút toán thì xóa đi để không hiển thị lên.
				if (rcEntry == RC_SUCCESS) {
					var rcDelete = entryFile.doDelete();
					if (rcDelete == RC_SUCCESS || rcDelete === true) {
						deletedIds.push(paymentId);
						affectedPaymentIds[paymentId] = true;
					} else {
						print("Lỗi hệ thống khi xóa bút toán cho paymentId: " + paymentId);
						failedIds.push(paymentId);
					}
				}
				// Nếu chưa có dòng bút toán thì không làm gì (không sinh ra dòng bút toán)
			} else {
				// Nếu số tiền hoàn ứng lần này > 0 => cập nhật hoặc sinh mới (hiển thị lên)
				if (rcEntry == RC_SUCCESS) {
					// ĐÃ CÓ -> UPDATE (giữ nguyên id cũ)
					entryFile["amount"] = currentRefund;
					entryFile["description"] = description;
					entryFile["ap.code"] = apCode;
					var rcUpdate = entryFile.doUpdate();

					if (rcUpdate == RC_SUCCESS) {
						updatedIds.push(paymentId);
						affectedPaymentIds[paymentId] = true;
					} else {
						print("Lỗi hệ thống khi cập nhật DB cho paymentId: " + paymentId);
						failedIds.push(paymentId);
					}

				} else {
					// CHƯA CÓ -> SINH ID THEO FORMAT payment.id + "." + số thứ tự bút toán
					var newId = generatePaymentEntryIdV2(paymentId);
					var newEntryFile = new SCFile("esdHTKTpaymentEntry");

					// B1: Lay tai khoan ghi no cua but toan tam ung de luu vao payment entry hoan ung.
					var accountNumber = "";
					var accountName = "";
					var prepaymentEntryFile = new SCFile("esdHTKTprepaymentEntry");
					var prepaymentEntryQuery = "prepayment.id=\"" + refId +
							"\" AND ledger.type=\"Prepayment\" AND account.type=\"DEBIT\"";
					var rcPrepaymentEntry = prepaymentEntryFile.doSelect(prepaymentEntryQuery);

					if (rcPrepaymentEntry == RC_SUCCESS) {
						accountNumber = prepaymentEntryFile['account.number'] || "";
						accountName = prepaymentEntryFile['account.name'] || "";
					} else {
						print("[PAYMENT_ENTRY_REFUND] Khong tim thay tai khoan tam ung cho refId: " + refId +
								", query=" + prepaymentEntryQuery);
					}

					// B2: Thêm mới
					newEntryFile['id'] = newId;
					newEntryFile['payment.id'] = paymentId;
					newEntryFile['vendor.id'] = vendorId;
					newEntryFile['entry.type'] = "PREPAYMENT";
					newEntryFile['ledger.type'] = "Standard";
					newEntryFile['account.type'] = "ASSET";
					newEntryFile['amount'] = currentRefund;
					newEntryFile['currency'] = currency;
					newEntryFile['account.number'] = accountNumber;
					newEntryFile['account.name'] = accountName;
					newEntryFile['description'] = description;
					newEntryFile['type'] = "AP";
					newEntryFile['order'] = 100;
					newEntryFile["ref.id"] = refId;
					newEntryFile["ap.code"] = apCode;
					var rcInsert = newEntryFile.doInsert();

					if (rcInsert === true || rcInsert === RC_SUCCESS) {
						addedIds.push(newId);
						affectedPaymentIds[paymentId] = true;
					} else {
						print("Lỗi hệ thống khi thêm mới DB cho paymentId: " + paymentId + ", id dự kiến: " + newId);
						failedIds.push(paymentId);
					}
				}
			}
		}

		var msgParts = [];
		if (updatedIds.length > 0) msgParts.push("Đã cập nhật: " + updatedIds.join(", "));
		if (addedIds.length > 0) msgParts.push("Đã thêm mới: " + addedIds.join(", "));
		if (deletedIds.length > 0) msgParts.push("Đã xóa: " + deletedIds.join(", "));
		if (failedIds.length > 0) msgParts.push("Thất bại: " + failedIds.join(", "));

		return {
			success: (updatedIds.length + addedIds.length + deletedIds.length) > 0 || (failedIds.length === 0),
			message: msgParts.length > 0 ? msgParts.join(" | ") : "Không có thay đổi"
		};

	} catch (parseError) {
		return { success: false, message: "Xảy ra lỗi trong quá trình xử lý dữ liệu: " + parseError.toString() };
	}
}


// Xu ly them moi THANH TOAN o tab cong no
function saveListPaymentEntryPayable(input) {
	var rawDetails = "";
	if (input.details) {
		rawDetails = input.details;
	} else if (input.queryString) {
		try {
			var parsedQuery = JSON.parse(input.queryString);
			if (parsedQuery.esdHTKTlistPaymentVendor && parsedQuery.esdHTKTlistPaymentVendor.details) {
				rawDetails = parsedQuery.esdHTKTlistPaymentVendor.details;
			} else {
				rawDetails = parsedQuery.details || input.queryString;
			}
		} catch (e) {
			rawDetails = input.queryString;
		}
	}

	if (!rawDetails) {
		return { success: false, message: "Thiếu dữ liệu chi tiết" };
	}

	try {
		var parsedData = JSON.parse(rawDetails);
		var dataObj = [];

		if (parsedData.dataFromPopup && Array.isArray(parsedData.dataFromPopup)) {
			dataObj = parsedData.dataFromPopup;
		} else if (Array.isArray(parsedData)) {
			dataObj = parsedData;
		} else {
			return { success: false, message: "Dữ liệu không đúng định dạng danh sách (Array)" };
		}

		if (dataObj.length === 0) {
			return { success: false, message: "Danh sách trống" };
		}

		var updatedIds = [];
		var addedIds = [];
		var deletedIds = [];
		var failedIds = [];
		var affectedPaymentIds = {};

		for (var i = 0; i < dataObj.length; i++) {
			var feeData = dataObj[i];

			var paymentId = feeData['paymentId'] || "";
			var vendorId = feeData['vendorId'] || "";
			var currentPayment = Number(feeData['currentPayment']) || 0;
			var currency = feeData['currency'] || "";
			var description = feeData['description'] || "";
			var refId = feeData['prepaymentId'] || feeData['refId'] || "";
			var apCode = feeData['apCode'];
			var order = feeData['order'] || 0;


			if (paymentId === "" || vendorId === "") {
				print("Bỏ qua dòng số " + (i + 1) + " do thiếu thông tin paymentId hoặc vendorId");
				failedIds.push(paymentId || ("dòng " + (i + 1)));
				continue;
			}

			var entryFile = new SCFile("esdHTKTpaymentEntry");
			var query = "payment.id=\"" + paymentId + "\" AND vendor.id=\"" + vendorId + "\" AND ref.id=\"" + refId + "\"";

			var rcEntry = entryFile.doSelect(query);

			if (currentPayment <= 0) {
				// Nếu số tiền thanh toán khoản phải trả = 0 thì không sinh bút toán.
				// Nếu trước đó đã tồn tại dòng bút toán thì xóa đi để không hiển thị lên.
				if (rcEntry == RC_SUCCESS) {
					var rcDelete = entryFile.doDelete();
					if (rcDelete == RC_SUCCESS || rcDelete === true) {
						deletedIds.push(paymentId);
						affectedPaymentIds[paymentId] = true;
					} else {
						print("Lỗi hệ thống khi xóa bút toán cho paymentId: " + paymentId);
						failedIds.push(paymentId);
					}
				}
			} else {
				// Tìm tài khoản phải trả của NCC từ vendorSite
				var accountNumber = "";
				var accountName = "";
				var vendorSiteId = "";

				// Tìm vendorSiteId từ paymentVendor để lấy site chính xác
				var pvFile = new SCFile("esdHTKTpaymentVendor");
				var rcPv = pvFile.doSelect('payment.id="' + paymentId + '" AND vendor.id="' + vendorId + '"');
				if (rcPv == RC_SUCCESS) {
					vendorSiteId = pvFile['vendor.site.id'] || "";
				}

				var vendorSiteFile = new SCFile("esdHTKTvendorSite");
				var rcSite = RC_NO_MORE;
				if (vendorSiteId) {
					rcSite = vendorSiteFile.doSelect('id="' + vendorSiteId + '"');
				}
				if (rcSite != RC_SUCCESS) {
					rcSite = vendorSiteFile.doSelect('vendor.id="' + vendorId + '"');
				}

				if (rcSite == RC_SUCCESS) {
					accountNumber = extractAccountNumber(vendorSiteFile['credit.account']);
				}
				if (accountNumber) {
					var glAccountFile = new SCFile("esdDMglAccount");
					var rcGl = glAccountFile.doSelect('account.number="' + accountNumber + '"');
					if (rcGl == RC_SUCCESS) {
						accountName = glAccountFile['account.name'] || "";
					}
				}

				if (rcEntry == RC_SUCCESS) {
					// ĐÃ CÓ -> UPDATE (giữ nguyên id cũ)
					entryFile["amount"] = currentPayment;
					entryFile["description"] = description;
					entryFile["ap.code"] = apCode;
					if (accountNumber) {
						entryFile['account.number'] = accountNumber;
						entryFile['account.name'] = accountName;
					}
					var rcUpdate = entryFile.doUpdate();

					if (rcUpdate == RC_SUCCESS) {
						updatedIds.push(paymentId);
						affectedPaymentIds[paymentId] = true;
					} else {
						print("Lỗi hệ thống khi cập nhật DB cho paymentId: " + paymentId);
						failedIds.push(paymentId);
					}

				} else {
					// CHƯA CÓ -> SINH ID THEO FORMAT payment.id + "." + số thứ tự bút toán
					var newId = generatePaymentEntryIdV2(paymentId);
					var newEntryFile = new SCFile("esdHTKTpaymentEntry");

					newEntryFile['id'] = newId;
					newEntryFile['payment.id'] = paymentId;
					newEntryFile['vendor.id'] = vendorId;
					newEntryFile['entry.type'] = "PAYABLE";
					newEntryFile['ledger.type'] = "Standard";
					newEntryFile['account.type'] = "DEBIT";
					newEntryFile['amount'] = currentPayment;
					newEntryFile['currency'] = currency;
					newEntryFile['account.number'] = accountNumber;
					newEntryFile['account.name'] = accountName;
					newEntryFile['description'] = description;
					newEntryFile['type'] = "AP";
					newEntryFile['order'] = +order || 1;
					newEntryFile["ref.id"] = refId;
					newEntryFile["ap.code"] = apCode;
					var rcInsert = newEntryFile.doInsert();

					if (rcInsert === true || rcInsert === RC_SUCCESS) {
						addedIds.push(newId);
						affectedPaymentIds[paymentId] = true;
					} else {
						print("Lỗi hệ thống khi thêm mới DB cho paymentId: " + paymentId + ", id dự kiến: " + newId);
						failedIds.push(paymentId);
					}
				}
			}
		}

		var msgParts = [];
		if (updatedIds.length > 0) msgParts.push("Đã cập nhật: " + updatedIds.join(", "));
		if (addedIds.length > 0) msgParts.push("Đã thêm mới: " + addedIds.join(", "));
		if (deletedIds.length > 0) msgParts.push("Đã xóa: " + deletedIds.join(", "));
		if (failedIds.length > 0) msgParts.push("Thất bại: " + failedIds.join(", "));

		return {
			success: (updatedIds.length + addedIds.length + deletedIds.length) > 0 || (failedIds.length === 0),
			message: msgParts.length > 0 ? msgParts.join(" | ") : "Không có thay đổi"
		};

	} catch (parseError) {
		return { success: false, message: "Xảy ra lỗi trong quá trình xử lý dữ liệu: " + parseError.toString() };
	}
}


/**
 * Sinh id dạng: <paymentId>.<số thứ tự bút toán không trùng>
 */
function generatePaymentEntryIdV2(paymentId) {
	var seq = 1;
	var newId = paymentId + "." + seq;
	var checkFile = new SCFile("esdHTKTpaymentEntry");

	// Kiểm tra xem ID đã tồn tại chưa, nếu đã có thì tăng seq lên 1
	while (checkFile.doSelect("id=\"" + newId + "\"") == RC_SUCCESS) {
		seq++;
		newId = paymentId + "." + seq;
	}

	return newId;
}

function getCurrentPaymentSummary(input) {
	var params = parseInputParams(input);
	var paymentId = String(params.paymentId || "").trim();
	var vendorId = String(params.vendorId || "").trim();

	// Khởi tạo kết quả mặc định
	var result = {
		success: false,
		paymentId: paymentId,
		vendorId: vendorId,
		currency: "",
		amount: 0, // Số tiền đề nghị thanh toán
		refund_amount: 0, // Số tiền hoàn ứng lần này
		approved_invoice_amount: 0 // Giá trị hóa đơn chấp nhận
	};

	if (!paymentId || !vendorId) {
		return result;
	}

	var query = 'payment.id = "' + escapeSmQueryValue(paymentId) + '" AND vendor.id = "' + escapeSmQueryValue(vendorId) + '"';
	var file = null;

	try {
		file = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
		var rc = file.doSelect(query);

		if (rc == RC_SUCCESS) {
			result.success = true;
			result.currency = String(file["currency"] || "").trim();
			result.amount = Number(file["amount"] || 0);
			result.refund_amount = Number(file["refund.amount"] || 0);
			result.approved_invoice_amount = Number(file["approved.invoice.amount"] || 0);
		}
	} catch (e) {
		print("[DEBUG getCurrentPaymentSummary] Error querying esdHTKTpaymentVendor: " + e);
	} finally {
		closeSCFile(file);
	}

	return result;
}



/**
 * Lấy tóm tắt 6 chỉ số công nợ theo đúng chuẩn Đặc tả nghiệp vụ (BR)
 */
function getSupplierDebtSummary(input) {
	var params = parseInputParams(input);
	var vendorId = String(params.vendorId || "").trim();
	var contractId = String(params.contractId || "").trim();
	var currentPaymentId = String(params.paymentId || "").trim();

	var summary = {
		tongPhaiTra: 0,
		tongDaThanhToan: 0,
		tongPhaiTraConLai: 0,
		tongDaTamUng: 0,
		tongDaHoanUng: 0,
		tongCoTheHoanUng: 0
	};

	if (!vendorId || !contractId) return summary;

	// 1. TÍNH CÁC KHOẢN TẠM ỨNG (Trường 4, 5, 6)
	var queryTamUng =
			"SELECT " +
			"ai.request.id AS requestId, " +
			"ai.prepayment.id AS prepaymentId, " +
			"ai.amount AS advance_amount, " +
			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +
			"aip.status AS ogl_status " +
			"FROM esdHTKTaccountingInformation ai " +
			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (ai.prepayment.id = pe.ref.id AND pe.entry.type = \"PREPAYMENT\") " +
			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (pe.accounting.request.id = aip.request.id) " +
			'WHERE ai.sub.type = "TAM_UNG" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP"';

	var tamUngMap = {};
	var tamUngOrder = [];
	var fileTamUng = null;

	try {
		fileTamUng = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rcTu = fileTamUng.doSelect(queryTamUng);
		while (rcTu == RC_SUCCESS) {
			var tuReqId = String(fileTamUng["requestId"] || "").trim();
			var tuPreId = String(fileTamUng["prepaymentId"] || "").trim();
			var tuKey = tuReqId + "|" + tuPreId;
			var tuAmount = getNumberField(fileTamUng, ["advance_amount", "ai.amount", "amount"]);
			var tuPeAmount = getNumberField(fileTamUng, ["payment_entry_amount", "pe.amount"]);
			var tuEntryPaymentId = String(fileTamUng["pe.payment.id"] || "").trim();
			var tuOglStatus = String(fileTamUng["aip.status"] || "").trim().toLowerCase();

			if (!tamUngMap[tuKey]) {
				tamUngMap[tuKey] = {
					amount: tuAmount,
					refunded_amount: 0,
					other_pending_amount: 0
				};
				tamUngOrder.push(tuKey);
			}

			var tuItem = tamUngMap[tuKey];
			if (tuPeAmount > 0) {
				if (tuOglStatus === "completed") {
					tuItem.refunded_amount += tuPeAmount;
				} else if (tuOglStatus !== "rejected" && tuOglStatus !== "cancelled" && tuOglStatus !== "failed") {
					if (tuEntryPaymentId && tuEntryPaymentId !== currentPaymentId) {
						tuItem.other_pending_amount += tuPeAmount;
					}
				}
			}
			rcTu = fileTamUng.getNext();
		}
	} catch (eTu) {
		print("[DEBUG getSupplierDebtSummary TAM_UNG] Error: " + eTu);
	} finally {
		closeSCFile(fileTamUng);
	}

	for (var i = 0; i < tamUngOrder.length; i++) {
		var itemTu = tamUngMap[tamUngOrder[i]];
		summary.tongDaTamUng += itemTu.amount;
		summary.tongDaHoanUng += itemTu.refunded_amount;
		var remTu = itemTu.amount - itemTu.refunded_amount - itemTu.other_pending_amount;
		if (remTu > 0) summary.tongCoTheHoanUng += remTu;
	}

	// 2. TÍNH THUẾ CỦA CÁC PHIẾU ĐNTƯ ĐÃ COMPLETED (sub.type = "THUE")
	var totalAdvanceTax = 0;
	var queryThue = 'contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND sub.type = "THUE" ' +
			'AND type = "AP" ' +
			'AND status = "COMPLETED"';
	var fileThue = null;
	try {
		fileThue = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rcThue = fileThue.doSelect(queryThue);
		while (rcThue == RC_SUCCESS) {
			totalAdvanceTax += getNumberField(fileThue, ["amount", "ai.amount"]);
			rcThue = fileThue.getNext();
		}
	} catch (eThue) {
		print("[DEBUG getSupplierDebtSummary THUE] Error: " + eThue);
	} finally {
		closeSCFile(fileThue);
	}

	// 3. TÍNH CÁC KHOẢN PHẢI TRẢ (Trường 1, 2, 3)
	var queryPhaiTra =
			"SELECT " +
			"ai.request.id AS requestId, " +
			"ai.prepayment.id AS prepaymentId, " +
			"ai.amount AS advance_amount, " +
			"ai.data AS ai_data, " +
			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +
			"aip.status AS ogl_status " +
			"FROM esdHTKTaccountingInformation ai " +
			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (ai.prepayment.id = pe.ref.id AND pe.entry.type = \"PAYABLE\" AND pe.account.type = \"ASSET\") " +
			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (pe.accounting.request.id = aip.request.id) " +
			'WHERE ai.sub.type = "THANH_TOAN" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP"';

	var phaiTraMap = {};
	var phaiTraOrder = [];
	var filePhaiTra = null;

	try {
		filePhaiTra = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
		var rcPt = filePhaiTra.doSelect(queryPhaiTra);
		while (rcPt == RC_SUCCESS) {
			var ptReqId = String(filePhaiTra["requestId"] || "").trim();
			var ptPreId = String(filePhaiTra["prepaymentId"] || "").trim();
			var ptKey = ptReqId + "|" + ptPreId;
			var ptAmount = getNumberField(filePhaiTra, ["advance_amount", "ai.amount", "amount"]);
			var ptPeAmount = getNumberField(filePhaiTra, ["payment_entry_amount", "pe.amount"]);
			var ptEntryPaymentId = String(filePhaiTra["pe.payment.id"] || "").trim();
			var ptOglStatus = String(filePhaiTra["aip.status"] || "").trim().toLowerCase();

			if (!phaiTraMap[ptKey]) {
				var initialPaid = 0;
				var rawData = filePhaiTra["ai_data"] || filePhaiTra["data"];
				if (rawData) {
					try {
						var parsed = JSON.parse(rawData);
						initialPaid = Number(parsed.amountPay || 0);
					} catch (ignore) {}
				}

				phaiTraMap[ptKey] = {
					amount: ptAmount,
					paid_amount: initialPaid,
					other_pending_amount: 0
				};
				phaiTraOrder.push(ptKey);
			}

			var ptItem = phaiTraMap[ptKey];
			if (ptPeAmount > 0) {
				if (ptOglStatus === "completed") {
					ptItem.paid_amount += ptPeAmount;
				} else if (ptOglStatus !== "rejected" && ptOglStatus !== "cancelled" && ptOglStatus !== "failed") {
					if (ptEntryPaymentId && ptEntryPaymentId !== currentPaymentId) {
						ptItem.other_pending_amount += ptPeAmount;
					}
				}
			}
			rcPt = filePhaiTra.getNext();
		}
	} catch (ePt) {
		print("[DEBUG getSupplierDebtSummary THANH_TOAN] Error: " + ePt);
	} finally {
		closeSCFile(filePhaiTra);
	}

	var totalPaymentCompleted = 0;
	for (var j = 0; j < phaiTraOrder.length; j++) {
		var itemPt = phaiTraMap[phaiTraOrder[j]];
		summary.tongPhaiTra += itemPt.amount;
		totalPaymentCompleted += itemPt.paid_amount;
		var remPt = itemPt.amount - itemPt.paid_amount - itemPt.other_pending_amount;
		if (remPt > 0) summary.tongPhaiTraConLai += remPt;
	}

	// Trường 2: Tổng tiền đã thanh toán = Tổng ĐNTT đã hạch toán + Tổng thuế ĐNTƯ đã hạch toán
	summary.tongDaThanhToan = totalPaymentCompleted + totalAdvanceTax;

	return summary;
}

function safeString(value) {
	if (value === null || value === undefined) return '';
	return String(value);
}

function extractAccountNumber(value) {
	var account = safeString(value).trim();
	var separator = '.';
	if (account.indexOf('-') >= 0) {
		separator = '-';
	}
	var firstSep = account.indexOf(separator);
	var secondSep = firstSep >= 0 ? account.indexOf(separator, firstSep + 1) : -1;
	var thirdSep = secondSep >= 0 ? account.indexOf(separator, secondSep + 1) : -1;

	if (secondSep < 0 || thirdSep < 0) return account;

	var extracted = account.substring(secondSep + 1, thirdSep).trim();
	return extracted || account;
}