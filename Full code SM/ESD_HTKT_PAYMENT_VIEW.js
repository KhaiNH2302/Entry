function getList() {
	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/DanhSachDeNghi', '', {})
}


function getTabThongTinDeNghi(endpoint, input, extraData) {
	var currentRecord = extraData;

	if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
		if (vars.$L_file) {
			var paymentId = vars.$L_file["id"];
			var currentPhase = vars.$L_file["current.phase"];
			var contractId = vars.$L_file["contract.id"];
			var initialRole = vars.$L_file["initial.role"];

			// Nếu thiếu phase hoặc role nhưng có payment.id, thực hiện query để lấy từ bảng esdHTKTpayment
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
				}
			}

			vars.$G_payment_id = paymentId;
			vars.$G_contract_id = contractId;

			currentRecord = {
				"id": vars.$L_file["id"],
				"contractId": contractId,
				"currentPhase": currentPhase,
				"initialRole": initialRole,
				"userCheckerKttc": vars.$L_file["user.checker.kttc"],
				"userCheckerDmms": vars.$L_file["user.checker.dmms"],
				"userApproverKttc": vars.$L_file["user.approver.kttc"],
				"userApproverDmms": vars.$L_file["user.approver.dmms"],
				"userCheckerFinal": vars.$L_file["user.checker.final"],
				"userApproverFinal": vars.$L_file["user.approver.final"],
				"createdBy": vars.$L_file["created.by"],
				"currentUser": vars['$lo.contact.name'],
				"status": vars.$L_file["status"],
				"isVendorEditable": (currentPhase == "initial_dmms" && vars.$L_file["created.by"] == vars['$lo.contact.name']) || (currentPhase == "initial_kttc" && initialRole == "kttc")
			};
		}
	}

	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/TabThongTinDeNghi', '', currentRecord);
}


function getTabChiTietThongTinHT(endpoint, input, extraData) {
	var formRecord = vars['$L.file'];
	var currentRecord = extraData || {};

	if (
			(!currentRecord || Object.keys(currentRecord).length === 0) &&
			formRecord
	) {
		currentRecord = formRecord;
	}

	var paymentId = vars.$G_payment_id;
	if (paymentId) {
		var paymentRec = new SCFile("esdHTKTpayment");
		var sql = "id=\"" + paymentId + "\"";

		if (paymentRec.doSelect(sql) === RC_SUCCESS) {
			currentRecord = {
				"paymentId": paymentId,
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

	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/TabThongTinHT/ChiTietHachToan', '', currentRecord)
}

function getTabThongTinHT(endpoint, input, extraData) {
	var formRecord = vars['$L.file'];
	var currentRecord = extraData || {};

	if (
			(!currentRecord || Object.keys(currentRecord).length === 0) &&
			formRecord
	) {
		currentRecord = formRecord;
	}

	var paymentId = currentRecord ?
			String(currentRecord['id'] || '') :
			'';

	var currentUser = String(
			vars['$lo.contact.name'] || ''
	).trim();

	var currentPhase = formRecord ?
			String(formRecord['current.phase'] || '').trim() :
			'';

	var userCheckerKttc = formRecord ?
			String(formRecord['user.checker.kttc'] || '').trim() :
			'';

	var initialRole = formRecord ?
			String(formRecord['initial.role'] || '').trim() :
			'';

	var createdBy = formRecord ?
			String(formRecord['created.by'] || '').trim() :
			'';

	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
			'HachToanKeToan/ThanhToan/TabThongTinHT',
			'', {
				id: paymentId,
				paymentId: paymentId,
				user: currentUser,
				currentUser: currentUser,
				contactId: currentUser,
				createdBy: createdBy,
				currentPhase: currentPhase,
				userCheckerKttc: userCheckerKttc,
				initialRole: initialRole,

				currentRecord: {
					id: paymentId,
					currentPhase: currentPhase,
					userCheckerKttc: userCheckerKttc,
					initialRole: initialRole
				}
			}
	);
}


function getTabHoSoDinhKem() {
	var currentRecord = {};

	if (vars.$L_file) {
		currentRecord = {
			"id": vars.$L_file["id"] || "",
			"contractId": vars.$L_file["contract.id"] || "",
			"vendorId": vars.$L_file["vendor.id"] || "",
			"currentPhase": vars.$L_file["current.phase"],
			"initialRole": vars.$L_file["initial.role"],
			"userCheckerKttc": vars.$L_file["user.checker.kttc"],
			"userCheckerDmms": vars.$L_file["user.checker.dmms"],
			"userApproverKttc": vars.$L_file["user.approver.kttc"],
			"userApproverDmms": vars.$L_file["user.approver.dmms"],
			"userCheckerFinal": vars.$L_file["user.checker.final"],
			"userApproverFinal": vars.$L_file["user.approver.final"],
			"createdBy": vars.$L_file["created.by"],
			"currentUser": vars['$lo.contact.name'],
			"status": vars.$L_file["status"]
		};
	}

	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
			'HachToanKeToan/ThanhToan/TabHoSoDinhKem',
			'',
			currentRecord
	);
}


function getTabKetQuaHachToan() {
	return lib.ESD_HTKT_PAYMENT_ENTRY_RESULT
			.renderTabAccountingResults();
}

function renderFormKySo() {
	var file = vars.$L_file;

	//    var conditionKySo = lib.ESD_MS_DXMS_CONDITION_WF.conditionKySo(file.id) || false;
	var conditionKySo = true;
	if (!conditionKySo) { return `<div style="
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  background-color: #fff3cd;
  border-left: 5px solid #ffc107;
  color: #856404;
  border-radius: 6px;
  font-family: Arial, sans-serif;
  font-size: 14px;
">
  <span style="font-size: 18px;">⚠️</span>
  <span><strong>Đang có người ký số</strong>, vui lòng thử lại trong ít phút.</span>
</div>` }

	return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/ky-so', `?id=${file.id}&userad=${vars["$lo.contact.name"]}`, {
		defaultFilter: '',
		user: vars['$lo.contact.name'],
		phieuId: vars.$L_file.id,
	});

}