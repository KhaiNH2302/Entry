/**
 * ScriptLibrary: ESD_ACTIONS_INTEGRATIONS
 * ------------------------------------------------------------
 * Author      : Hoang Quoc Anh / Team HTKT & Tích hợp
 * Team        : [Tich hop]
 * Created Date: 2026-04-08
 * Version     : 2.1.0
 *
 * Description :
 * Thư viện dùng chung điều phối các action tích hợp ký số và ECM
 * cho tất cả các phân hệ:
 * - Đề xuất mua sắm (DXMS - esdMSdxmsAttach)
 * - Đề nghị thanh toán (HTKT Payment - ESD_HTKT_PAYMENT_DOCUMENT)
 * - Đề nghị tạm ứng (HTKT Prepayment - ESD_HTKT_PREPAYMENT_DOCUMENT)
 * ------------------------------------------------------------
 */

function safeParse(str) {
	if (typeof str === "object" && str !== null) return str;
	try {
		return JSON.parse(str);
	} catch (e) {
		return str;
	}
}

/**
 * Nhận diện phân hệ nghiệp vụ: "PAYMENT" | "PREPAYMENT" | "DXMS"
 */
function resolveModuleType(file) {
	if (!file) return "DXMS";
	var id = "";
	if (typeof file === "string") {
		id = file.trim();
	} else {
		id = String(
			file.id ||
			file.paymentId ||
			file["payment.id"] ||
			file.prepaymentId ||
			file["prepayment.id"] ||
			file.dxmsId ||
			file["dxms.id"] ||
			""
		).trim();
	}

	var upperId = id.toUpperCase();
	if (upperId.indexOf("TT.") === 0 || upperId.indexOf("TT") === 0) {
		return "PAYMENT";
	}
	if (upperId.indexOf("TU.") === 0 || upperId.indexOf("TU") === 0) {
		return "PREPAYMENT";
	}
	if (upperId.indexOf("DXMS") === 0 || upperId.indexOf("MS") === 0) {
		return "DXMS";
	}

	// Kiểm tra qua thuộc tính table nếu có
	var table = String(file.table || file.tableName || "").toLowerCase();
	if (table.indexOf("payment") >= 0) return "PAYMENT";
	if (table.indexOf("prepayment") >= 0) return "PREPAYMENT";
	if (table.indexOf("dxms") >= 0 || table.indexOf("ms") >= 0) return "DXMS";

	// Kiểm tra qua database nếu ID không theo tiền tố chuẩn
	if (id) {
		try {
			var fPay = new SCFile("esdHTKTpayment", SCFILE_READONLY);
			if (fPay && fPay.doSelect('id="' + id + '"') === RC_SUCCESS) {
				fPay.doClose();
				return "PAYMENT";
			}
			if (fPay) fPay.doClose();
		} catch (e1) {}

		try {
			var fPre = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
			if (fPre && fPre.doSelect('id="' + id + '"') === RC_SUCCESS) {
				fPre.doClose();
				return "PREPAYMENT";
			}
			if (fPre) fPre.doClose();
		} catch (e2) {}

		try {
			var fDx = new SCFile("esdMSdxmsAttach", SCFILE_READONLY);
			if (fDx && fDx.doSelect('dxms.id="' + id + '"') === RC_SUCCESS) {
				fDx.doClose();
				return "DXMS";
			}
			if (fDx) fDx.doClose();
		} catch (e3) {}
	}

	return "DXMS";
}

function popup_add_e_form(file) {
	try {
		if (!file || !file.id || !file.name) {
			return {
				Code: "false",
				Msg: "Thiếu thông tin file"
			};
		}

		var result = lib.ESD_ECM_SERVICE.uploadFileTaiLieu({
			"docCat": "Phiếu đề xuất mua sắm" + file.name,
			"docName": "Phiếu đề xuất mua sắm" + file.name,
			"cifNum": file.id,
			"accNum": file.id,
			"docCreated": system.functions.tod(),
			"sourceId": "CSEP_QLTS",
			"sessionId": "csep_session",
			"appId": "NEWTPSS",
			"fileBytes": vars["$base64PDF"],
			"fileName": file.name + ".pdf",
			"seq": "1",
			"userId": "ach"
		});

		result = JSON.parse(result);
		if (result) {
			var nextId = lib.ESD_Utils.generateNextNumber("esdMSdxmsAttach");

			lib.ESD_Utils.CreateTicket("esdMSdxmsAttach", {
				"id": nextId,
				"dxms.id": file.id,
				"name": "Phiếu đề xuất mua sắm" + file.name,
				"attach.type": "E-form",
				"executor": system.user.name,
				"attach.id": result.Data[0].ObjectId,
				"attach.type": "Trinh ky"
			});

			return result;
		}

		return {
			Code: "false",
			Msg: "Upload ECM thất bại",
			Data: result
		};

	} catch (err) {
		return {
			Code: "false",
			Msg: "Thất bại: " + err
		};
	}
}

function get_file_ecm(file) {
	try {
		file = safeParse(file);
		if (!file || !file.id) {
			return {
				Code: "Fail",
				Msg: "Thiếu file.id"
			};
		}

		var mod = resolveModuleType(file);
		if (mod === "PAYMENT") {
			return lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm(file);
		}
		if (mod === "PREPAYMENT") {
			return lib.ESD_HTKT_PREPAYMENT_DOCUMENT.get_file_ecm(file);
		}

		// DXMS Logic
		var fields = ["dxms.id", "name", "attach.type", "executor", "attach.id", "status"];

		var result = lib.ESD_Utils.fetchData(
			"esdMSdxmsAttach",
			'dxms.id="' + file.id + '" and attach.type="Trinh ky"',
			fields
		);

		if (!result || result.length == 0) {
			return [];
		}
		var status = "Da ky";
		var hasNotSigned = result.some(function(item) {
			return item.status && item.status !== "Da ky";
		});

		if (hasNotSigned) {
			status = "Chua ky";
		}

		var params = result
			.filter(function(item) {
				return item["attach.id"];
			})
			.map(function(item) {
				return {
					DOC_OBJECTID: item["attach.id"],
					APP_ID: "NEWTPSS",
					SESSION_ID: "csep_session"
				};
			});

		if (!params.length) {
			return [];
		}

		var data = lib.ESD_ECM_SERVICE.downloadDocument(params);

		return { success: data.success, message: data.message, data: data.data, params: params, status: status };

	} catch (err) {
		return {
			Code: "Fail",
			Msg: "get_file_ecm error: " + err
		};
	}
}

/**
 * ky-so
 * Check trạng thái ký số
 * HSM: gui luon
 * SMCA: Ký xong gửi 1 request -> wait từ vấn tin -> kết quả ký số -> gọi [sendInfoSign] lần 2 để lưu xem thành công hay thất bại.
 * @params {
 *   id,
 *   userad,
 *   object_ids[{
 *     old: "...",
 *     new: "..."
 *   }],
 *   sign_tech: HSM | SMART-GOI | SMARTCA
 * }
 */
function ky_so(file) {
	file = safeParse(file);
	if (!file) return { statusCode: "99", statusDesc: "Thiếu tham số", success: false };

	var id = file.id;
	var userad = file.userad;
	var object_ids = file.object_ids || file.objectIds || [];
	var sign_tech = file.sign_tech || file.signTech || "";

	if (!object_ids || object_ids.length == 0) {
		return { statusCode: "00", statusDesc: "Đã tiếp nhận yêu cầu ký số", success: true };
	}

	var mod = resolveModuleType(file);

	if (mod === "PAYMENT") {
		var signedPair = object_ids[0] || {};
		if (signedPair.new) {
			var replaceResult = lib.ESD_HTKT_PAYMENT_DOCUMENT.replaceCurrentVersion({
				paymentId: id,
				currentUser: userad,
				oldObjectId: signedPair.old,
				newObjectId: signedPair.new,
				newDocId: signedPair.newDocId,
				cifNum: file.cifNum || id,
				accNum: file.accNum || id
			});
			return {
				statusCode: replaceResult.success === true ? "00" : "99",
				statusDesc: replaceResult.message || (replaceResult.success ? "Cập nhật thông tin ký số thành công" : "Cập nhật thông tin ký số thất bại"),
				success: replaceResult.success === true,
				code: replaceResult.code,
				detail: replaceResult.detail,
				data: replaceResult.data
			};
		}
		return { statusCode: "00", statusDesc: "Đã tiếp nhận yêu cầu ký số", success: true };
	}

	if (mod === "PREPAYMENT") {
		var signedPairPre = object_ids[0] || {};
		if (signedPairPre.new) {
			var replaceResultPre = lib.ESD_HTKT_PREPAYMENT_DOCUMENT.replaceCurrentVersion({
				prepaymentId: id,
				currentUser: userad,
				oldObjectId: signedPairPre.old,
				newObjectId: signedPairPre.new,
				newDocId: signedPairPre.newDocId,
				cifNum: file.cifNum || id,
				accNum: file.accNum || id
			});
			return {
				statusCode: replaceResultPre.success === true ? "00" : "99",
				statusDesc: replaceResultPre.message || (replaceResultPre.success ? "Cập nhật thông tin ký số thành công" : "Cập nhật thông tin ký số thất bại"),
				success: replaceResultPre.success === true,
				code: replaceResultPre.code,
				detail: replaceResultPre.detail,
				data: replaceResultPre.data
			};
		}
		return { statusCode: "00", statusDesc: "Đã tiếp nhận yêu cầu ký số", success: true };
	}

	// ===== DXMS =====
	if (sign_tech == "HSM" || (object_ids[0] && object_ids[0].new)) {
		updateTable(id, object_ids, "Da ki");
		if (lib.ESD_MS_DXMS_COMMON && typeof lib.ESD_MS_DXMS_COMMON.returnKySo === "function") {
			lib.ESD_MS_DXMS_COMMON.returnKySo(id, userad, sign_tech || "HSM");
		}
		return { statusCode: "00", statusDesc: "Cập nhật chữ ký thành công", success: true };
	} else {
		if (typeof sendSignRequest === "function") {
			sendSignRequest(file);
		}
		return { statusCode: "00", statusDesc: "Đã gửi yêu cầu ký số", success: true };
	}
}

function updateTable(dxmsId, object_ids, status) {
	var file = new SCFile("esdMSdxmsAttach");
	var rc = file.doSelect('dxms.id="' + dxmsId + '"');
	while (rc == RC_SUCCESS) {
		for (var i = 0; i < object_ids.length; i++) {
			var obj = object_ids[i];
			if (obj.old && obj.new && file["attach.id"] == obj.old) {
				file["attach.id"] = obj.new;
				file["status"] = status;
				rc = file.doUpdate();
				break;
			}
		}
		rc = file.getNext();
	}
}

function addFileECM(file) {
	file = safeParse(file);
	var mod = resolveModuleType(file);

	if (mod === "PAYMENT") {
		return lib.ESD_HTKT_PAYMENT_DOCUMENT.addFileECM_HTKT(file);
	}
	if (mod === "PREPAYMENT") {
		return lib.ESD_HTKT_PREPAYMENT_DOCUMENT.addFileECM_HTKT(file);
	}

	// DXMS Logic
	try {
		var result = lib.ESD_ECM_SERVICE.uploadFileTaiLieu({
			"docCat": file.documentName,
			"docName": file.documentName,
			"cifNum": file.id,
			"accNum": file.id,
			"docCreated": system.functions.tod(),
			"sourceId": "CSEP_QLTS",
			"sessionId": "csep_session",
			"appId": "NEWTPSS",
			"fileBytes": file.base64File,
			"fileName": file.documentName + "." + file.type,
			"seq": "1",
			"userId": "ach"
		});

		result = JSON.parse(result);

		if (result) {
			var nextId = lib.ESD_Utils.generateNextNumber("esdMSdxmsAttach");

			lib.ESD_Utils.CreateTicket("esdMSdxmsAttach", {
				"id": nextId,
				"dxms.id": file.id,
				"name": file.documentName,
				"attach.type": "Trình ký",
				"executor": file.user,
				"attach.id": result.Data[0].ObjectId,
				"note": file.note,
				"document.type": "Tài liệu đính kèm hồ sơ",
				"doc.id": result.Data[0].DocId,
				"table": file.table
			});
		}

		return {
			Code: "OK",
			Msg: "Cập nhật thành công",
			Data: result
		};

	} catch (err) {
		return {
			Code: "false",
			Msg: "Thất bại: " + err
		};
	}
}

function deleteFileECM(file) {
	file = safeParse(file);
	var mod = resolveModuleType(file);

	if (mod === "PAYMENT") {
		return lib.ESD_HTKT_PAYMENT_DOCUMENT.deleteFileECM_HTKT(file);
	}
	if (mod === "PREPAYMENT") {
		return lib.ESD_HTKT_PREPAYMENT_DOCUMENT.deleteFileECM_HTKT(file);
	}

	// DXMS Logic
	try {
		if (file && file.docId) {
			return lib.ESD_ECM_SERVICE.deleteDocument([{
				DOC_ID: file.docId,
				APP_ID: "NEWTPSS",
				SESSION_ID: "csep_session"
			}]);
		}
		return { Code: "OK", Msg: "Xóa thành công" };
	} catch (err) {
		return { Code: "false", Msg: "Xóa thất bại: " + err };
	}
}

function getStatusSign(file) {
	file = safeParse(file);
	var mod = resolveModuleType(file);

	if (mod === "PAYMENT") {
		var currentResPay = lib.ESD_HTKT_PAYMENT_DOCUMENT.getCurrentPresentation(file);
		if (currentResPay && currentResPay.success === true) {
			var docPay = currentResPay.data;
			var isCompletedPay = docPay.status === "COMPLETED";
			return {
				Code: "OK",
				status: isCompletedPay,
				data: docPay,
				statusCode: "00",
				statusDesc: isCompletedPay ? "Bản trình ký đã hoàn tất" : "Bản trình ký đang chờ ký"
			};
		}
		return {
			Code: "NOT_FOUND",
			status: false,
			statusCode: "99",
			statusDesc: currentResPay ? currentResPay.message : "Không tìm thấy bản trình ký"
		};
	}

	if (mod === "PREPAYMENT") {
		var currentResPre = lib.ESD_HTKT_PREPAYMENT_DOCUMENT.getCurrentPresentation(file);
		if (currentResPre && currentResPre.success === true) {
			var docPre = currentResPre.data;
			var isCompletedPre = docPre.status === "COMPLETED";
			return {
				Code: "OK",
				status: isCompletedPre,
				data: docPre,
				statusCode: "00",
				statusDesc: isCompletedPre ? "Bản trình ký đã hoàn tất" : "Bản trình ký đang chờ ký"
			};
		}
		return {
			Code: "NOT_FOUND",
			status: false,
			statusCode: "99",
			statusDesc: currentResPre ? currentResPre.message : "Không tìm thấy bản trình ký"
		};
	}

	// DXMS Logic
	try {
		var fields = ["dxms.id", "status"];
		var result = lib.ESD_Utils.fetchData(
			"esdMSdxmsAttach",
			'dxms.id="' + file.id + '" and attach.type="Trinh ky"',
			fields
		);
		var status = "Da ky";
		if (result && result.length) {
			var hasNotSigned = result.some(function(item) {
				return item.status && item.status !== "Da ky";
			});
			if (hasNotSigned) status = "Chua ky";
		}
		return { Code: "OK", status: status === "Da ky", statusCode: "00", statusDesc: status };
	} catch (e) {
		return { Code: "Fail", status: false, statusCode: "99", statusDesc: String(e) };
	}
}
