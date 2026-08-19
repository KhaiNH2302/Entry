/**
 * ScriptLibrary: ESD_ECM_SERVICE
 * ------------------------------------------------------------
 * Author      : Do Quang Minh
 * Team        : [ADDON]
 * Created Date: 2026-04-08
 * Version     : 1.0.0
 *
 * Description :
 *
 **/


var config = {
	URL: {
		UPLOAD_DOCUMENT:
				"http://10.6.129.152:8080/CDM/service/document/upload?userid=ach",
		DOWNLOAD_DOCUMENT:
				"http://10.6.129.152:8080/CDM/service/document/download?userid=ach",
		DELETE_DOCUMENT:
				"http://10.6.129.152:8080/CDM/service/document/delete?userid=ach",
	},
	AUTHORIZATION: "Basic Y3BtOkFhMTIzNDU2",
	USER_ID: "ach",
};

/**
 * API Download file from ECM by DOC_ID
 * @param params {DOC_ID | DOC_OBJECTID, APP_ID, SESSION_ID}
 * @returns {
 *  Code: "OK",
 *  Msg: "Thành công",
 * Data: [{
 *  "1221313133.pdf: "base64", // "doc_id.pdf": "base64"
 * }] }
 */
function downloadDocument(params) {
	params = params || {};
	var items = Array.isArray(params) ? params : [params];

	if (!items.length) {
		return {
			success: false,
			message: "Thiếu dữ liệu đầu vào.",
		};
	}

//  var payload = [];
//  for (var i = 0; i < items.length; i++) {
//    var item = items[i] || {};
//    var docId = item.docId || item.DOC_ID;
//    var docObjectId = item.docObjectId || item.DOC_OBJECTID;
//    var appId = item.appId || item.APP_ID;
//    var sessionId = item.sessionId || item.SESSION_ID;
//
//    if (!docId && !docObjectId) {
//      return {
//        success: false,
//        message: "Thiếu doc_id hoặc doc_objectId tại file " + (i + 1) + ".",
//      };
//    }
//
//    if (!appId) {
//      return {
//        success: false,
//        message: "Thiếu appId tại file " + (i + 1) + ".",
//      };
//    }
//
//    if (!sessionId) {
//      return {
//        success: false,
//        message: "Thiếu sessionId tại file " + (i + 1) + ".",
//      };
//    }
//
//    payload.push({
//      DOC_ID: docId,
//      DOC_OBJECTID: String(docObjectId),
//      APP_ID: String(appId),
//      SESSION_ID: String(sessionId),
//    });
//  }

	var headers = [];
	headers.push(new Header("Content-Type", "application/json"));
	headers.push(new Header("Authorization", config.AUTHORIZATION));

	try {
		var resp = lib.ESD_COMMON_HTTP.postJson(
				config.URL.DOWNLOAD_DOCUMENT,
				JSON.stringify(params),
				headers
		);
		return {
			success: true,
			message: "Thành công.",
			data: JSON.parse(resp)
		};
	} catch (e) {
		return {
			success: false,
			message:
					"Không thể tải tài liệu từ ECM. Vui lòng kiểm tra lại thông tin đầu vào hoặc thử lại sau.",
			error: e && e.message ? e.message : String(e),
			request: {
				url: config.URL.DOWNLOAD_DOCUMENT,
				payload: payload,
			},
		};
	}
}

/**
 * API upload document
 * @param params {docCat, docName, cifNum, accNum, docCreated, sourceId, sessionId, appId, fileBytes, fileName, seq} | [] of these
 * @returns {
 *  Code: "OK",
 *  Msg: "Thành công",
 *  Data: [{
 *  "DocId: "1111",
 *  "DocName": "Bảo lãnh tiền ứng trước",
 *  "ObjectId": "09090909fjf",
 *  "Seq": 1
 *  }] }
 */
function uploadFileTaiLieu(params) {
	params = params || {};
	var items = Array.isArray(params) ? params : [params];

	if (!items.length) {
		return {
			success: false,
			message: "Thiếu dữ liệu đầu vào.",
		};
	}

	var payload = [];
	for (var i = 0; i < items.length; i++) {
		var item = items[i] || {};

		if (
				!item.appId ||
				!item.sessionId ||
				!item.docCat ||
				!item.docName ||
				!item.cifNum ||
				!item.accNum ||
				!item.sourceId ||
				!item.fileBytes ||
				!item.fileName ||
				!item.seq ||
				!item.docCreated
		) {
			return {
				success: false,
				message: "Không đủ dữ liệu đầu vào cho file " + (i + 1) + ".",
			};
		}

		payload.push({
			DOC_CAT: item.docCat,
			DOC_NAME: item.docName,
			CIF_NUM: item.cifNum,
			ACC_NUM: item.accNum,
			DOC_CREATED: item.docCreated || "",
			SOURCE_ID: item.sourceId,
			SESSION_ID: String(item.sessionId),
			APP_ID: String(item.appId),
			FILE_BYTES: item.fileBytes,
			FILE_NAME: item.fileName,
			SEQ: item.seq,
		});
	}

	var headers = [];
	headers.push(new Header("Content-Type", "application/json"));
	headers.push(new Header("Authorization", config.AUTHORIZATION));

	try {
		var resp = lib.ESD_COMMON_HTTP.postJson(
				config.URL.UPLOAD_DOCUMENT,
				JSON.stringify(payload),
				headers
		);
		return resp;
	} catch (e) {
		return {
			success: false,
			message:
					"Không thể tải tài liệu lên ECM. Vui lòng kiểm tra lại thông tin đầu vào hoặc thử lại sau.",
			error: e && e.message ? e.message : String(e),
			request: {
				url: config.URL.UPLOAD_DOCUMENT,
				payload: payload,
			},
		};
	}
}

/**
 * Delete document from ECM
 * @param params {docId | DOC_ID, appId | APP_ID, sessionId | SESSION_ID} | [] of these
 * @returns {
 *  Code: "OK",
 *  Msg: "Thành công"
 * }
 */
function deleteDocument(params) {
	params = params || {};
	var items = Array.isArray(params) ? params : [params];

	if (!items.length) {
		return {
			success: false,
			message: "Thiếu dữ liệu đầu vào.",
		};
	}

	var payload = [];
	for (var i = 0; i < items.length; i++) {
		var item = items[i] || {};
		var docId = item.docId || item.DOC_ID;
		var appId = item.appId || item.APP_ID;
		var sessionId = item.sessionId || item.SESSION_ID;

		if (!docId) {
			return {
				success: false,
				message: "Thiếu docId tại file " + (i + 1) + ".",
			};
		}

		if (!appId) {
			return {
				success: false,
				message: "Thiếu appId tại file " + (i + 1) + ".",
			};
		}

		if (!sessionId) {
			return {
				success: false,
				message: "Thiếu sessionId tại file " + (i + 1) + ".",
			};
		}

		payload.push({
			DOC_ID: String(docId),
			APP_ID: String(appId),
			SESSION_ID: String(sessionId),
		});
	}

	var headers = [];
	headers.push(new Header("Content-Type", "application/json"));
	headers.push(new Header("Authorization", config.AUTHORIZATION));

	try {
		var resp = lib.ESD_COMMON_HTTP.postJson(
				config.URL.DELETE_DOCUMENT,
				payload,
				headers
		);
		return {
			success: true,
			message: "Xóa tài liệu thành công.",
			data: resp
		};
	} catch (e) {
		return {
			success: false,
			message:
					"Không thể xóa tài liệu trên ECM. Vui lòng kiểm tra lại thông tin đầu vào hoặc thử lại sau.",
			error: e && e.message ? e.message : String(e),
			request: {
				url: config.URL.DELETE_DOCUMENT,
				payload: payload,
			},
		};
	}
}

function downloadWithURL(input) {
	/*
	  input{
		  param1,
		  param2,
		  objId,
	  }
	  */
	var result = {
		success: false,
		message: "",
	};

	if (!input || !input.param1 || !input.param2 || !input.objId) {
		result.message = "Không đủ dữ liệu đầu vào cho hàm downloadWithURL";

		return result;
	}

	var baseUrl = "";
	var fullUrl =
			baseUrl +
			`/ecmapi/rest/download/v2.0/objectId/${input.objId}/parameter1/${input.param1}/parameter2/${input.param2}`;
	var headers = {};
	var resp = lib.ESD_COMMON_HTTP.get(fullUrl, headers);

	return result;
}

//function formatDate(date) {
//    const pad = (num) => (num <10 ? '0' + num : '' + num);
//
//    const day = pad(date.getDate());
//    const month = pad(date.getMonth() + 1);
//    const year = date.getFullYear();
//    const hour = pad(date.getHours());
//    const minute = pad(date.getMinutes());
//
//    return `${day}${month}${year}${hour}${minute}`;
//
//}
//function generateUrl(objectId) {
//    var now = new Date()
//    var p1 = formatDate(now);
//    var p2 = lib.ESD_MD5.md5(p1);
//
//    var url = "http://ecmtestuat.vietinbank.vn/ecmapi/rest/download/v2.0/objectId/"
//        + encodeURIComponent(objectId)
//        + "/parameter1/" + p1
//        + "/parameter2/" + p2;
//
//    return url;
//}
//print(generateUrl("0902852080b9d48e"));