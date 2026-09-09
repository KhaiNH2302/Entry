
function renderTabInvoice(endpoint, input, extraData) {
	var currentRecord = extraData;

	if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
		if (vars.$L_file) {
			var paymentId = vars.$L_file["payment.id"];
			var currentPhase = vars.$L_file["current.phase"];
			var initialRole = vars.$L_file["initial.role"];
			var userCheckerKttc = vars.$L_file["user.checker.kttc"];
			var userCheckerDmms = vars.$L_file["use.checker.dmms"];
			//
			var userApproverKttc = vars.$L_file["user.approver.kttc"];
			var userApproverDmms = vars.$L_file["user.approver.dmms"];
			var userCheckerFinal = vars.$L_file["user.checker.final"];
			var userApproverFinal = vars.$L_file["user.approver.final"];
			var userApproverKttc = vars.$L_file["user.approver.kttc"];
			var createdBy = vars.$L_file["created.by"];

			var status = vars.$L_file["status"];

			if ((!currentPhase || !initialRole) && paymentId) {
				var prepFile = new SCFile("esdHTKTpayment");
				var sqlPrep = "id=\"" + paymentId + "\"";
				var rcPrep = prepFile.doSelect(sqlPrep);

				if (rcPrep == RC_SUCCESS) {
					if (!currentPhase && prepFile["current.phase"]) {
						currentPhase = prepFile["current.phase"];
					}
					if (!initialRole && prepFile["initial.role"]) {
						initialRole = prepFile["initial.role"];
					}
					if (!userCheckerKttc && prepFile["user.checker.kttc"]) {
						userCheckerKttc = prepFile["user.checker.kttc"];
					}
					if (!userCheckerDmms && prepFile["use.checker.dmms"]) {
						userCheckerDmms = prepFile["use.checker.dmms"];
					}
					//
					if (!userApproverKttc && prepFile["user.approver.kttc"]) {
						userApproverKttc = prepFile["user.approver.kttc"];
					}
					if (!userApproverDmms && prepFile["user.approver.dmms"]) {
						userApproverDmms = prepFile["user.approver.dmms"];
					}
					if (!userCheckerFinal && prepFile["user.checker.final"]) {
						userCheckerFinal = prepFile["user.checker.final"];
					}
					if (!userApproverFinal && prepFile["user.approver.final"]) {
						userApproverFinal = prepFile["user.approver.final"];
					}
					if (!createdBy && prepFile["created.by"]) {
						createdBy = prepFile["created.by"];
					}
					if (!status && prepFile["status"]) {
						status = prepFile["status"];
					}
				}
			}

			// Gán dữ liệu vào currentRecord
			currentRecord = {
				"id": vars.$L_file["id"],
				"payment.id": paymentId,
				"contract.id": vars.$L_file["contract.id"],
				"payment.status": vars.$L_file["payment.status"],
				"vendor.number": vars.$L_file["vendor.number"],
				"vendor.id": vars.$L_file["vendor.id"],
				"currentPhase": currentPhase,
				"initialRole": initialRole,
				"userCheckerKttc": userCheckerKttc,
				"userCheckerDmms": userCheckerDmms,

				"userApproverKttc": userApproverKttc,
				"userApproverDmms": userApproverDmms,
				"userCheckerFinal": userCheckerFinal,
				"userApproverFinal": userApproverFinal,
				"createdBy": createdBy,

				"status": status,
				"currentUser": vars['$lo.contact.name']
			};
		}
	}

	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabHoaDon', '', currentRecord);
}

//Dung cho tab thong tin cong no
function renderTabLiabilityInfo(endpoint, input, extraData) {
	var currentRecord = extraData;

	// 1. Kiểm tra và khởi tạo object nếu extraData trống
	if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
		if (vars.$L_file) {
			currentRecord = {
				"id": vars.$L_file["id"],
				"payment.id": vars.$L_file["payment.id"],
				"contract.id": vars.$L_file["contract.id"],
				"payment.status": vars.$L_file["payment.status"],
				"vendor.number": vars.$L_file["vendor.number"],
				"vendor.id": vars.$L_file["vendor.id"]
			};
		} else {
			currentRecord = {};
		}
	}

	// 2. Thêm query lấy contract.id dựa vào payment.id nếu contract.id chưa có giá trị

	var paymentId = currentRecord["payment.id"] || vars.$L_file["payment.id"];
	if (paymentId && !currentRecord["contract.id"]) {
		var paymentRec = new SCFile("esdHTKTpayment");
		var sql = "id=\"" + paymentId + "\"";

		if (paymentRec.doSelect(sql) === RC_SUCCESS) {
			currentRecord = {
				"id": vars.$L_file["id"],
				"paymentId": paymentId,
				"contractId": paymentRec["contract.id"],
				"vendorId": vars.$L_file["vendor.id"],
				"currentPhase": paymentRec["current.phase"],
				"initialRole": paymentRec["initial.role"],
				"createdBy": paymentRec["created.by"],
				"userCheckerDmms": paymentRec["user.checker.dmms"],
				"userCheckerKttc": paymentRec["user.checker.kttc"],
				"userApproverKttc": paymentRec["user.approver.kttc"],
				"userApproverDmms": paymentRec["user.approver.dmms"],
				"userCheckerFinal": paymentRec["user.checker.final"],
				"userApproverFinal": paymentRec["user.approver.final"],
				"currentUser": vars['$lo.contact.name'],
				"status": paymentRec["status"]
			};
		}
	}
	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS("HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabThongTinCongNo", '', currentRecord);
}



//function getTabCostDivision(endpoint, input, extraData) {
//    var currentRecord = extraData;
//
//    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
//        if (vars.$L_file) {
//            var paymentId = vars.$L_file["payment.id"];
//            var currentPhase = vars.$L_file["current.phase"];
//            var initialRole = vars.$L_file["initial.role"];
//
//            if ((!currentPhase || !initialRole) && paymentId) {
//                var prepFile = new SCFile("esdHTKTpayment");
//                var sqlPrep = "id=\"" + paymentId + "\"";
//                var rcPrep = prepFile.doSelect(sqlPrep);
//
//                if (rcPrep == RC_SUCCESS) {
//                    if (!currentPhase && prepFile["current.phase"]) {
//                        currentPhase = prepFile["current.phase"];
//                    }
//                    if (!initialRole && prepFile["initial.role"]) {
//                        initialRole = prepFile["initial.role"];
//                    }
//                }
//            }
//
//            // Gán dữ liệu vào currentRecord
//            currentRecord = {
//                "id": vars.$L_file["id"],
//                "payment.id": paymentId,
//                "contract.id": vars.$L_file["contract.id"],
//                "payment.status": vars.$L_file["payment.status"],
//                "vendor.number": vars.$L_file["vendor.number"],
//                "vendor.id": vars.$L_file["vendor.id"],
//                "currentPhase": currentPhase,
//                "initialRole": initialRole
//            };
//        }
//    }
//
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
//        "HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabPhanChiaChiPhi",
//        "",
//        currentRecord
//    );
//}
function getTabCostDivision(endpoint, input, extraData) {
	var currentRecord = extraData;

	// Kiểm tra nếu extraData trống thì tìm dữ liệu từ vars.$L_file hoặc $G_
	if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
		if (vars.$L_file) {
			currentRecord = {
				paymentId: vars.$L_file["payment.id"] || vars.$G_payment_id,
				contractId: vars.$L_file["contract.id"] || vars.$G_contract_id,
				vendorId: vars.$L_file["vendor.id"] || vars.$L_file["vendor.number"] || vars.$G_vendor_id,
				id: vars.$L_file["id"],
				paymentStatus: vars.$L_file["payment.status"],
				vendorNumber: vars.$L_file["vendor.number"],
			};
		} else {
			// Fallback về biến toàn cục $G_ nếu không có $L_file
			currentRecord = {
				paymentId: vars.$G_payment_id,
				contractId: vars.$G_contract_id,
				vendorId: vars.$G_vendor_id,
			};
		}
	}

	var paymentId = currentRecord["payment.id"] || vars.$L_file["payment.id"];
	if (paymentId && !currentRecord["contract.id"]) {
		var paymentRec = new SCFile("esdHTKTpayment");
		var sql = "id=\"" + paymentId + "\"";

		if (paymentRec.doSelect(sql) === RC_SUCCESS) {
			currentRecord = {
				"id": vars.$L_file["id"],
				"paymentId": paymentId,
				"contractId": paymentRec["contract.id"],
				"vendorId": vars.$L_file["vendor.id"],
				"currentPhase": paymentRec["current.phase"],
				"initialRole": paymentRec["initial.role"],
				"createdBy": paymentRec["created.by"],
				"userCheckerDmms": paymentRec["user.checker.dmms"],
				"userCheckerKttc": paymentRec["user.checker.kttc"],
				"userApproverKttc": paymentRec["user.approver.kttc"],
				"userApproverDmms": paymentRec["user.approver.dmms"],
				"userCheckerFinal": paymentRec["user.checker.final"],
				"userApproverFinal": paymentRec["user.approver.final"],
				"currentUser": vars['$lo.contact.name'],
				"status": paymentRec["status"]
			};
		}
	}


	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
			"HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabPhanChiaChiPhi",
			"",
			currentRecord
	);
}
