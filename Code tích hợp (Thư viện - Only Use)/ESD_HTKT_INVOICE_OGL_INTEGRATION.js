var logger = getLog("ESD_HTKT_INVOICE_OGL_INTEGRATION");
/**
 * Hàm tao activity
 */

/**
 * Kiểm tra hóa đơn (Check Invoice)
 * @param {Object} invoiceData - Object chứa thông tin hóa đơn truyền vào từ SM
 * @returns {Object|null} Trả về data kết quả từ API hoặc null
 */
function checkInvoice(invoiceData) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/invoice/check-invoice";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(invoiceData), headers);
	logger.info('checkInvoice::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

/**
 * 2. Kiểm tra số tiền hóa đơn (Check Amount)
 * @param {Array} checkAmountList - Mảng danh sách các object chứa thông tin số tiền cần kiểm tra
 */
function checkAmount(checkAmountList) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/invoice/check-amount";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(checkAmountList), headers);
	logger.info('checkAmountList::response: ' + responseStr);
	if (responseStr) {
		return rteJSONParse(responseStr);
	}
	return null;
}


// Van tin site NCC
function getVendorSiteInfo(vendorData) {
	if (!vendorData || !vendorData.vendorNumber) {
		print('Du lieu truy van khong hop le');
		return null;
	}
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;
	var queryParams = [];
	['entity', 'vendorName', 'vendorNumber', 'vendorSiteCode'].forEach(name => {
		if (vendorData[name]) {
			queryParams.push(`${name}=${encodeURIComponent(vendorData[name])}`);
		}
	});
	var url = `${config.oglBaseUrl}/vendors/site-info?${queryParams.join('&')}`;
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.get(url, headers);
	logger.info('getVendorSiteInfo::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Tao site/Ncc 
function createVendorSiteInfo(vendorData) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/vendors/site";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(vendorData), headers);
	logger.info('createVendorSiteInfo::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Kiem tra cong no
function checkVendorDebtReport(vendorData) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/vendor-debts/report";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(vendorData), headers);
	logger.info('checkVendorDebtReport::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Thanh toan hoa don
function createApInvoice(invoiceData) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/ap/create-invoice";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(invoiceData), headers);
	logger.info('createApInvoice::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Kiem tra trang thai giao dich AP
function checkAP(apData) {
	if (!apData || !apData.transactionId || apData.transactionId.trim().length === 0 || !apData.requestId || apData.requestId.trim().length === 0) return null;
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;
	const { transactionId, requestId } = apData;
	var url = `${config.oglBaseUrl}/ap/check?transactionId=${encodeURIComponent(transactionId)}&requestId=${encodeURIComponent(requestId)}`;
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.get(url, headers);
	logger.info('checkAP::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Hach toan batch phan he OGL
function createBatchGL(glData) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/general-ledger/interface";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(glData), headers);
	logger.info('createBatchGL::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Kiem tra trang thai batch
function checkBatchGl(transactionId) {
	if (!transactionId || transactionId.trim().length === 0) return null;
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var checkData = { "transactionId": transactionId };

	var url = config.oglBaseUrl + "/batch/status";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(checkData), headers);
	logger.info('checkBatchGl::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

// Thanh toan yeu cau thanh toan da co tu truoc
function createApPayment(invoiceData) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.oglBaseUrl + "/ap/create-payment";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token)
	];

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(invoiceData), headers);
	logger.info('createApPayment::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}