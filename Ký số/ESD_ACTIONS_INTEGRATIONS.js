/**
 * ScriptLibrary: ESD_ACTIONS_INTEGRATIONS
 * ------------------------------------------------------------
 * Author      : Hoang Quoc Anh
 * Team        : [Tich hop]
 * Created Date: 2026-04-08
 * Version     : 2.0.0
 *
 * Add function get file
 * Description :
 * dessign action in integrations
 *
 */

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

		if (!file || !file.id) {
			return {
				Code: "Fail",
				Msg: "Thiếu file.id"
			};
		}

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

		return { success: data.success, message: data.message, data: data.data, params, status };

	} catch (err) {

		return {
			Code: "Fail",
			Msg: "get_file_ecm error: " + err
		};
	}
}
/** ky-so  Check trạng thái ký số HSM: gui luon SMCA: Ký xong gửi 1 request -> wait từ vấn tin -> kết quả ký số -> gọi [sendInfoSign] lần 2 để lưu xem thành công hay thất bại. @params {
      id,
      userad,
      object_ids[{
        old: "11kjfkjakljkdfla",
        new: "22ckclpapdaop;ao".
      }],
      sign_tech: HSM | SMART-GOI,   } @return {   } */
function ky_so(file) {
	var id = file.id;
	var userad = file.userad;
	var object_ids = file.object_ids;
	var sign_tech = file.sign_tech;
	if (!object_ids || object_ids.length == 0) return;
	// ===== HSM: kis xong =====
	if (sign_tech == "HSM") {
		updateTable(id, object_ids, "Da ki");
		lib.ESD_MS_DXMS_COMMON.returnKySo(id, userad, "HSM");
	}else{
		sendSignRequest(file);
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
	try {
		var result = lib.ESD_ECM_SERVICE.uploadFileTailieu({
			"docCat": file.documentName,
			"docName": file.documentName,
			"cilNum": file.id,
			"accNum": file.id,
			"docCreated": system.functions.tod(),
			"sourceId": "CSEP_QLTS",
			"sessionId": "csep_session",
			"appId": "NEWTPS",
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