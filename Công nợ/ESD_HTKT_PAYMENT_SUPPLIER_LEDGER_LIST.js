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
//                =====================TEST(Safe to delete)======================
			case "getListSupplierLedgerTest":
				result = { success: true, data: getListSupplierLedgerTest(input) };
				break;
			case "getListAccountsPayableTest":
				result = { success: true, data: getListAccountsPayableTest(input) };
				break;
//            ======
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

			"ai.data AS ai_data, " +// Để lấy currency

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
			'AND ai.type = "AP" '+
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
					description: "",           // Khởi tạo description của đề nghị lần này
					// Các biến khởi tạo tính toán
					advance_amount: advanceAmount,
					refunded_amount: 0,        // Số tiền đã hoàn ứng (đã hạch toán xong và không thuộc ĐNTT hiện tại)
					other_pending_amount: 0,   // Số tiền chờ duyệt ở các ĐNTT khác
					current_refund_amount: 0,   // Số tiền hoàn ứng lần này (của ĐNTT hiện tại)
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
				} ;
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



//
////============List thanh toan================================================
//function getListAccountsPayable(input) {
//    var params = parseInputParams(input);
//    var vendorId = String(params.vendorId || "").trim();
//    var contractId = String(params.contractId || "").trim();
//    var currentPaymentId = String(params.paymentId || "").trim();
//
//    if (!vendorId || !contractId) return [];
//
//    var query =
//        "SELECT " +
//        "ai.request.id AS requestId, " +
//        "ai.prepayment.id AS prepaymentId, " +
//        "ai.vendor.id AS vendorId, " +
//        "ai.type AS type, " +
//        "ai.status AS status, " +
//        "ai.message AS message, " +
//        "ai.response AS response, " +
//        "ai.transaction.id AS transactionId, " +
//        "ai.ap.code AS apCode, " +
//        "ai.checked.time AS checkedTime, " +
//        "ai.sub.type AS subType, " +
//        "ai.amount AS advance_amount, " +
//        "ai.contract.id AS contractId, " +
//        
//        "ai.data AS ai_data, " +// Để lấy currency
//        
//        "pe.amount AS payment_entry_amount, " +
//        "pe.payment.id AS entry_payment_id, " +
//        
//        "pe.description AS pe_description, " +
//
//        "aip.status AS ogl_status " +
//        
//        "FROM esdHTKTaccountingInformation ai " +
//        
//        "LEFT JOIN esdHTKTpaymentEntry pe " +
////        "ON (ai.prepayment.id = pe.payment.id  " +
//        "ON (ai.prepayment.id = pe.ref.id  " +
//        'AND pe.entry.type = "PAYABLE" ' +
//        'AND pe.account.type = "ASSET") ' + 
//        
//        "LEFT JOIN esdHTKTaccountingInformation aip " +
//        "ON (pe.accounting.request.id = aip.request.id ) " +
//        
//        
//        'WHERE ai.sub.type = "THANH_TOAN" ' +
//        'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
//        'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
//        'AND ai.status = "COMPLETED" ' +
//        'AND ai.type = "AP" '+
//        'ORDER BY ai.checked.time DESC'; // Sắp xếp ngày hạch toán mới nhất
//
//
//    var resultMap = {};
//    var resultOrder = [];
//    var file = null;
//
//    try {
//        file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
//        var rc = file.doSelect(query);
//
//        while (rc == RC_SUCCESS) {
//            var accountingInformationId = String(file["requestId"] || "").trim();
//            var prepaymentId = String(file["prepaymentId"] || "").trim();
//            var advanceAmount = getNumberField(file, ["advance_amount", "ai.amount", "amount"]);
//            var paymentEntryAmount = getNumberField(file, ["payment_entry_amount", "pe.amount"]);
//            
//            var entryPaymentId = String(file["pe.payment.id"] || "").trim();
//            var oglStatus = String(file["aip.status"] || "").trim().toLowerCase();
//            var peDescription = String(file["pe.description"] || "").trim(); // Lấy description từ payment entry
//
//            var key = accountingInformationId + "|" + prepaymentId;
//
//            if (!resultMap[key]) {
//                resultMap[key] = {
//                    requestId: accountingInformationId,
//                    prepaymentId: prepaymentId,
//                    vendorId: String(file["vendorId"] || "").trim(),
//                    type: String(file["type"] || "").trim(),
//                    status: String(file["status"] || "").trim(),
//                    message: String(file["message"] || "").trim(),
//                    response: String(file["response"] || "").trim(),
//                    transactionId: String(file["transactionId"] || "").trim(),
//                    apCode: String(file["ap.code"] || file["apCode"] || ""),
//                    checkedTime: file["checkedTime"] || "",
//                    subType: String(file["subType"] || "").trim(),
//                    amount: advanceAmount,
//                    contractId: String(file["contractId"] || "").trim(), 
//                    description: "",           // Khởi tạo description của đề nghị lần này
//                    
//                    
//                    
//                    // Các biến khởi tạo tính toán
//                    totalTax: 0, // Cot thue - chua biet lay o dau
//                    advance_amount: advanceAmount, //Số tiền thanh toán sau thuế
//                    paid_amount: 0,        // Số tiền đã hoàn thanh toán (đã hạch toán xong và không thuộc ĐNTT hiện tại)
//                    other_pending_amount: 0,   // Số tiền chờ duyệt ở các ĐNTT khác
//                    current_payment_amount: 0,   // Số tiền thanh toán lần này (của ĐNTT hiện tại)
//                    //Các biến lấy từ cột data bảng esdHTKTaccountingInformation
//                    currency: ""
//                };
//                
//                var rawData = file["ai_data"] || file["data"];
//                if (rawData) {
//                    try {
//                        var parsedData = JSON.parse(rawData);
//                        resultMap[key].currency = parsedData.currency || String(file["currency"] || "").trim();
//                    } catch (e) {
//                        print("[DEBUG run] Error parsing column 'data': " + e);
//                        resultMap[key].currency = String(file["currency"] || "").trim();
//                    }
//                } else {
//                    resultMap[key].currency = String(file["currency"] || "").trim();
//                }
//                
//                
//                resultOrder.push(key);
//            }
//
//            var item = resultMap[key];
//
//            if (paymentEntryAmount > 0) {
//                // 1. Cứ COMPLETED là tính vào "Số tiền đã hoàn ứng" (Không quan tâm phiếu nào)
//                if (oglStatus === "completed") {
//                    item.paid_amount += paymentEntryAmount;
//                } ;
//                // 2. Nếu thuộc Phiếu hiện tại -> "Số tiền hoàn ứng lần này"
//                if (currentPaymentId && entryPaymentId === currentPaymentId) {
//                    item.current_payment_amount += paymentEntryAmount;
//                    if (peDescription) {
//                        item.description = peDescription; // Gán description từ payment entry của đề nghị hiện tại
//                    }
//                } 
//                // 3. Nếu CHƯA Completed mà thuộc Phiếu khác (và không bị Hủy/Từ chối) -> "Chờ duyệt ở ĐNTT khác"
//                else if (oglStatus !== "rejected" && oglStatus !== "cancelled" && oglStatus !== "failed") {
//                    if (entryPaymentId) {
//                        item.other_pending_amount += paymentEntryAmount;
//                    }
//                }
//            }
//
//            rc = file.getNext();
//        }
//    } finally {
//        closeSCFile(file);
//    }
//
//    // Tính toán lại remaining_amount và xuất ra danh sách
//    var itemList = [];
//    for (var i = 0; i < resultOrder.length; i++) {
//        var resultItem = resultMap[resultOrder[i]];
//        
//        // Công thức chuẩn theo tài liệu:
//        // Còn lại
//        resultItem.remaining_amount = resultItem.advance_amount - resultItem.paid_amount - resultItem.other_pending_amount;
//        if (resultItem.remaining_amount < 0) resultItem.remaining_amount = 0;
//        
//        itemList.push(resultItem);
//    }
//
//    return itemList;
//}


//============List thanh toan================================================
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

			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +
			"pe.description AS pe_description, " +

			"FROM esdHTKTaccountingInformation ai " +
			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (ai.prepayment.id = pe.payment.id  " +
			'AND pe.entry.type = "PAYABLE" ' +
			'AND pe.account.type = "ASSET") ' +
			'JOIN esdHTKTpaymentVendor pv (ON pv.payment.id = pe.payment.id and pv.vendor.id = "' + escapeSmQueryValue(vendorId) + '") ' +
			'WHERE ai.sub.type = "THANH_TOAN" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP" '+
			'AND ai.prepayment.id != "' + escapeSmQueryValue(currentPaymentId) + '" ' +
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
			var paymentEntryAmount = getNumberField(file, ["payment_entry_amount", "pe.amount"]);

			var entryPaymentId = String(file["pe.payment.id"] || "").trim();
			var peDescription = String(file["pe.description"] || "").trim(); // Lấy description từ payment entry

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
				description: "",           // Khởi tạo description của đề nghị lần này


				// Các biến khởi tạo tính toán
				totalTax: 0, // Cot thue - chua biet lay o dau
				advance_amount: advanceAmount, //Số tiền thanh toán sau thuế
				paid_amount: 0,        // Số tiền đã hoàn thanh toán (đã hạch toán xong và không thuộc ĐNTT hiện tại)
				other_pending_amount: 0,   // Số tiền chờ duyệt ở các ĐNTT khác
				current_payment_amount: 0,   // Số tiền thanh toán lần này (của ĐNTT hiện tại)
				//Các biến lấy từ cột data bảng esdHTKTaccountingInformation
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

			if (paymentEntryAmount > 0) {
				// 1. Cứ COMPLETED là tính vào "Số tiền đã hoàn ứng" (Không quan tâm phiếu nào)
				// if (oglStatus === "completed") {
				//     item.paid_amount += paymentEntryAmount;
				// } ;
				// 2. Nếu thuộc Phiếu hiện tại -> "Số tiền hoàn ứng lần này"
				if (currentPaymentId && entryPaymentId === currentPaymentId) {
					item.current_payment_amount += paymentEntryAmount;
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

			item.remaining_amount =
					item.advance_amount - item.paid_amount - item.other_pending_amount;
			if (item.remaining_amount < 0) item.remaining_amount = 0;

			itemList.push(item);
			rc = file.getNext();
		}
	} finally {
		closeSCFile(file);
	}

	// Tính toán lại remaining_amount và xuất ra danh sách
	/* Kết quả đã được tạo trực tiếp theo từng dòng query. */

	// Công thức chuẩn theo tài liệu:
	// Còn lại


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
		var failedIds = [];
		var affectedPaymentIds = {};

		for (var i = 0; i < dataObj.length; i++) {
			var feeData = dataObj[i];

			var paymentId = feeData['paymentId'] || "";
			var vendorId = feeData['vendorId'] || "";
			var currentRefund = feeData['currentRefund'] || 0;
			var currency = feeData['currency'] || "";
			var description = feeData['description'] || "";
			var refId = feeData['prepaymentId'] || "";

			if (paymentId === "" || vendorId === "") {
				print("Bỏ qua dòng số " + (i + 1) + " do thiếu thông tin paymentId hoặc vendorId");
				failedIds.push(paymentId || ("dòng " + (i + 1)));
				continue;
			}

			var entryFile = new SCFile("esdHTKTpaymentEntry");
			var query = "payment.id=\"" + paymentId + "\" AND vendor.id=\"" + vendorId + "\" AND ref.id=\"" + refId + "\"";


			var rcEntry = entryFile.doSelect(query);

			if (rcEntry == RC_SUCCESS) {
				// ĐÃ CÓ -> UPDATE (giữ nguyên id cũ)
				entryFile["amount"] = currentRefund;
				entryFile["description"] = description;
				if (rcPrepaymentEntry == RC_SUCCESS) {
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
				var newId = generatePaymentEntryId(paymentId);
				var newEntryFile = new SCFile("esdHTKTpaymentEntry");


				// B1: Lay tai khoan ghi no cua but toan tam ung de luu vao payment entry hoan ung.
				var accountNumber = "";
				var accountName = "";
				var prepaymentEntryFile = new SCFile("esdHTKTprepaymentEntry");
				var prepaymentEntryQuery = "prepayment.id=\"" + refId
						+ "\" AND ledger.type=\"Prepayment\" AND account.type=\"DEBIT\"";
				var rcPrepaymentEntry = prepaymentEntryFile.doSelect(prepaymentEntryQuery);

				if (rcPrepaymentEntry == RC_SUCCESS) {
					accountNumber = prepaymentEntryFile['account.number'] || "";
					accountName = prepaymentEntryFile['account.name'] || "";
				} else {
					print("[PAYMENT_ENTRY_REFUND] Khong tim thay tai khoan tam ung cho refId: " + refId
							+ ", query=" + prepaymentEntryQuery);
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

		var msgParts = [];
		if (updatedIds.length > 0) msgParts.push("Đã cập nhật: " + updatedIds.join(", "));
		if (addedIds.length > 0) msgParts.push("Đã thêm mới: " + addedIds.join(", "));
		if (failedIds.length > 0) msgParts.push("Thất bại: " + failedIds.join(", "));

		return {
			success: (updatedIds.length + addedIds.length) > 0,
			message: msgParts.join(" | ")
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
		var failedIds = [];
		var affectedPaymentIds = {};

		for (var i = 0; i < dataObj.length; i++) {
			var feeData = dataObj[i];

			var paymentId = feeData['paymentId'] || "";
			var vendorId = feeData['vendorId'] || "";
			var currentPayment = feeData['currentPayment'] || 0;
			var currency = feeData['currency'] || "";
			var description = feeData['description'] || "";
			//TODO: xem lai
//            var refId = feeData['refId'] || "";
			var refId = feeData['prepaymentId'] || "";
			var order = feeData['order'] || 0;

			if (paymentId === "" || vendorId === "") {
				print("Bỏ qua dòng số " + (i + 1) + " do thiếu thông tin paymentId hoặc vendorId");
				failedIds.push(paymentId || ("dòng " + (i + 1)));
				continue;
			}

			var entryFile = new SCFile("esdHTKTpaymentEntry");
			var query = "payment.id=\"" + paymentId + "\" AND vendor.id=\"" + vendorId + "\" AND ref.id=\"" + refId + "\"";


			var rcEntry = entryFile.doSelect(query);

			if (rcEntry == RC_SUCCESS) {
				// ĐÃ CÓ -> UPDATE (giữ nguyên id cũ)
				entryFile["entry.type"] = "PAYABLE";
				entryFile["ledger.type"] = "Standard";
				entryFile["account.type"] = "ASSET";
				entryFile["amount"] = currentPayment;
				entryFile["currency"] = currency;
				entryFile["description"] = description;
				entryFile["type"] = "AP";
				entryFile["ref.id"] = refId;
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
				newEntryFile['account.type'] = "ASSET";
				newEntryFile['amount'] = currentPayment;
				newEntryFile['currency'] = currency;
				newEntryFile['description'] = description;
				newEntryFile['type'] = "AP";
				newEntryFile['order'] = +order;
				newEntryFile["ref.id"] = refId;
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

		// syncPaymentEntries(affectedPaymentIds); // Bỏ comment nếu hàm này đã tồn tại trong SL

		var msgParts = [];
		if (updatedIds.length > 0) msgParts.push("Đã cập nhật: " + updatedIds.join(", "));
		if (addedIds.length > 0) msgParts.push("Đã thêm mới: " + addedIds.join(", "));
		if (failedIds.length > 0) msgParts.push("Thất bại: " + failedIds.join(", "));

		return {
			success: (updatedIds.length + addedIds.length) > 0,
			message: msgParts.join(" | ")
		};

	} catch (parseError) {
		return { success: false, message: "Xảy ra lỗi trong quá trình xử lý dữ liệu: " + parseError.toString() };
	}
}




/**
 * Sinh id dạng: <paymentId>.<số thứ tự bút toán>
 * Ví dụ: payment.id = "TT.100.26.0000004" đã có 1 bút toán -> trả về "TT.100.26.0000004.2"
 */
function generatePaymentEntryId(paymentId) {
	var countFile = new SCFile("esdHTKTpaymentEntry");
	var query = "payment.id=\"" + paymentId + "\"";
	var rc = countFile.doSelect(query);

	var count = 0;
	while (rc == RC_SUCCESS) {
		count++;
		rc = countFile.getNext();
	}

	var nextSeq = count + 1;
	return paymentId + "." + nextSeq;
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
		amount: 0,                   // Số tiền đề nghị thanh toán
		refund_amount: 0,            // Số tiền hoàn ứng lần này
		approved_invoice_amount: 0   // Giá trị hóa đơn chấp nhận
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


//====================================================
//====================TEST==============================
//============test list hoan ung======================================
//========08072026_2:51PM Test
function getListSupplierLedgerTest(input) {
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
			'AND ai.type = "AP" '+
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
					description: "",           // Khởi tạo description của đề nghị lần này
					// Các biến khởi tạo tính toán
					advance_amount: advanceAmount,
					refunded_amount: 0,        // Số tiền đã hoàn ứng (đã hạch toán xong và không thuộc ĐNTT hiện tại)
					other_pending_amount: 0,   // Số tiền chờ duyệt ở các ĐNTT khác
					current_refund_amount: 0,   // Số tiền hoàn ứng lần này (của ĐNTT hiện tại)
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
				} ;
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












//======test list phai tra===========
function getListAccountsPayableTest(input) {
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

			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +

			"pe.description AS pe_description, " +

			"aip.status AS ogl_status " +

			"FROM esdHTKTaccountingInformation ai " +

			"LEFT JOIN esdHTKTpaymentEntry pe " +
			//        "ON (ai.prepayment.id = pe.payment.id  " +
			"ON (ai.prepayment.id = pe.ref.id  " +
			'AND pe.entry.type = "PAYABLE" ' +
			'AND pe.account.type = "ASSET") ' +

			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (pe.accounting.request.id = aip.request.id ) " +


			//        'WHERE ai.sub.type = "THANH_TOAN" ' +
			'WHERE ai.sub.type LIKE "%THANH_TOAN%" ' +
			'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
			'AND ai.vendor.id = "' + escapeSmQueryValue(vendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP" '+
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
					description: "",           // Khởi tạo description của đề nghị lần này



					// Các biến khởi tạo tính toán
					advance_amount: advanceAmount,
					refunded_amount: 0,        // Số tiền đã hoàn ứng (đã hạch toán xong và không thuộc ĐNTT hiện tại)
					other_pending_amount: 0,   // Số tiền chờ duyệt ở các ĐNTT khác
					current_refund_amount: 0,   // Số tiền hoàn ứng lần này (của ĐNTT hiện tại)
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
				} ;
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
//==================

//==============END TEST=============