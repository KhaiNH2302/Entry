var logger = getLog("ESD_HTKT_FUND_TRANSFER_INTEGRATION");

//Van tin tai khoan trong he thong
function checkNameAccount(acctId) {
	var requestId = lib.UUID.generateUUID().toLowerCase();
	if (!acctId) {
		print('HTKT::checkNameAccount: Du lieu dau vao chua hop le');
		logger.info('HTKT::checkNameAccount: Du lieu dau vao chua hop le');
		return;
	}
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	//    ["coreClientId","coreChannel","corePassword","coreUsername"].forEach(k=> {
	//        print(`${k} : ${config[k]}`);
	//    })
	if (!token || !config) return null;
	print

	var url = config.coreBaseUrl + "/prf-dep-inq/v1/acct-inq";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token),
		new Header("RequestId", requestId),
		new Header("username", config['coreUsername']),
		new Header("password", config['corePassword']),
		new Header("ClientID", config['coreClientId']),
		new Header("RequestTime", lib.ESD_HTKT_Utils.formatDateToISOWithOffset2())
	];
	var data = {
		"data": {
			"acctId": acctId
		}
	};
	logger.info('checkNameAccount::request: ' + rteJSONStringify(data));
	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(data), headers);
	logger.info('checkNameAccount::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

//checkNameAccount('1111');

//Van tin tai khoan ngoai he thong
function checkNameAccountNapas(acctId, napasCode) {
	var requestId = lib.UUID.generateUUID().toLowerCase();
	if (!acctId || !napasCode) {
		logger.info('HTKT::checkNameAccount: Du lieu dau vao chua hop le');
		return;
	}
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.coreBaseUrl + "/gateway-info-inq/v1/gwinfoinq";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token),
		new Header("requestId", "ac1b7dc8-bd99-425a-a775-56bd512ab33b"),
		new Header("username", config['coreUsername']),
		new Header("password", config['corePassword']),
		new Header("ClientID", config['coreClientId']),
		new Header("RequestTime", lib.ESD_HTKT_Utils.formatDateToISOWithOffset()),
	];

	var checkData = {
		"spname": "com.fnf.xes.SML",
		"reftype": config['coreClientId'],
		"refid": config['coreClientId'],
		"data": {
			"gwLogicalName": "G003_SML",
			"gwActionCode": "S03_SML_ACCOUNT_INQ",
			"acctIdFrom": "100868368326",
			"acctIdTo": acctId,
			"bankIdTo": napasCode,
			"postingDt": lib.ESD_HTKT_Utils.formatDateToISO(),
			"processingCode": "432020",
			"amt": 0,
			"curCode": "VND",
			"comment": "RTGS Transaction",
			"acquiredId": "970415",
			"merchantType": "7399"
		}
	};
	logger.info('checkNameAccount::request: ' + rteJSONStringify(checkData));
	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(checkData), headers);
	logger.info('checkNameAccount::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}
//checkNameAccountNapas('0975745245', '970422');

//Chuyen tien trong he thong
function fundTranfer(transferData) {
	if (!transferData || !transferData["requestId"] || !transferData['data']) {
		logger.info('HTKT::fundTranfer: Du lieu dau vao chua hop le');
		return null;
	}
	var requestId = transferData["requestId"];
	var dateString = lib.ESD_HTKT_Utils.formatDateToISOWithOffset();
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.coreBaseUrl + "/api/transfer-in/fundstransferadd";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token),
		new Header("requestId", requestId),
		new Header("username", config['coreUsername']),
		new Header("password", config['corePassword']),
		new Header("ClientID", config['coreClientId']),
		new Header("RequestTime", dateString),
	];

	transferData['clientDt'] = dateString;
	transferData['channel'] = config['coreChannel'];
	transferData['trnRefNum'] = requestId;
	//    var data = {
	//        "requestId": requestId,
	//        "clientDt": dateString,
	//        "channel": config['coreChannel'],
	//        "spname": "com.xesapi.xferadd20.FunsTransferAdd",
	//        "data": {
	//            "depAcctIdFrom": {
	//                "acctId": "1111",
	//                "acctCur": "VND"
	//            },
	//            "depAcctIdTo": {
	//                "acctId": "117000115134",
	//                "acctCur": "VND"
	//            },
	//            "amount": "10000", // so tien chuyen
	//            "curCode": "VND", // loai tien
	//            "reversedInd": "N",
	//            "trnRefNum": requestId,
	//            "notes": "Chuyen tien trong he thong" // Nội dung chuyển tiền
	//        }
	//    };

	logger.info('fundTranfer::request: ' + rteJSONStringify(transferData));
	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(transferData), headers);
	logger.info('fundTranfer::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}

//Chuyen tien ngoai he thong
function fundTranferOut(transferData) {
	if (!transferData || !transferData["requestId"] || !transferData['data']) {
		logger.info('HTKT::fundTranfer: Du lieu dau vao chua hop le');
		return null;
	}

	//    var requestId = lib.UUID.generateUUID().toLowerCase();
	var dateString = lib.ESD_HTKT_Utils.formatDateToISOWithOffset();
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('core');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.coreBaseUrl + "/api/transfer-out/pmtadd";
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Authorization", "Bearer " + token),
		new Header("requestId", transferData["requestId"]),
		new Header("username", config['coreUsername']),
		new Header("password", config['corePassword']),
		new Header("channel", config['coreChannel']),
		new Header("ClientID", config['coreClientId']),
		new Header("RequestTime", lib.ESD_HTKT_BASE_API_INTEGRATION.getUnixTimestamp())
	];
	transferData['clientDt'] = dateString;
	transferData['channel'] = config['coreChannel'];
	transferData['reftype'] = config['coreUsername'];
	transferData['data']['chanRefNum'] = transferData["requestId"];
	transferData['data']['fromAcctId'] = '101870783864'; // cần config
	//    var data = {
	//        "requestId": requestId,
	//        "clientDt": dateString,
	//        "channel": config['coreChannel'],
	//        "reftype": "IB",
	//        //        "refid": "945284",
	//        "spname": "com.fnf.xes.PRF",
	//        "data": {
	//            //            "uid": "",
	//            "serviceBranch": "",
	//            "approveId": "",
	//            "pmtType": "Outgoing IBPS_Bilateral",
	//            "pmtMethod": "Account",
	//            "trnType": "Transaction Internet Banking",
	//            "fromAcctId": "101870783864", // tai khoan chuyen
	//            //            "fromBankId": "", // citad
	//            //            "fromBranchId": "",
	//            //            "fromAcctName": "",
	//            //            "toCardNum": "",
	//            "toAcctId": "", // tai khoan nhan
	//            "toBankId": "", // citad code
	//            "toBranchId": "79616001", // citad branch code
	//            "toAcctName": "NGUYEN THI MY LIEN", // ten nguoi thu huong
	//            "amount": [{
	//                "amount": "3000", // so tien chuyen
	//                "crcd": "VND", // loai tien chuyen
	//                "amountType": "TRAN_AMOUNT"
	//            }],
	//            "trnDesc": "CHUYEN TIEN", // noi dung chuyen tien
	//            "chanRefNum": requestId
	//        }
	//    };
	logger.info('fundTranferOut::request: ' + rteJSONStringify(transferData));
	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, rteJSONStringify(transferData), headers);
	logger.info('fundTranferOut::response: ' + responseStr);
	if (responseStr) {
		var responseObj = rteJSONParse(responseStr);
		if (responseObj) {
			return responseObj;
		}
	}

	return null;
}
