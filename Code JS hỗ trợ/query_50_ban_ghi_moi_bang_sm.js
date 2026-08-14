/**
 * Lay toi da 50 ban ghi moi bang trong Service Manager.
 * Khong loc theo paymentId/prepaymentId. Chi doc, khong ghi DB.
 * Chay truc tiep toan bo script trong SM JavaScript Test/ScriptLibrary.
 */

var MAX_ROWS = 500;

var TABLES = [
  {
    name: 'esdHTKTpayment',
    fields: ['id', 'contract.id', 'contract.name', 'department', 'description',
      'current.phase', 'created.by',
      'total.advance.amount', 'total.amount.paid', 'total.refund.amount', 'currentcy']
  },
  {
    name: 'esdHTKTpaymentVendor',
    fields: ['payment.id', 'vendor.id', 'vendor.site.id', 'approved.invoice.amount',
      'amount', 'refund.amount', 'vendor.type', 'currency', 'payment.method',
      'beneficiary.account', 'beneficiary.name', 'beneficiary.bank', 'exchange.rate',
      'payment.rate']
  },
  {
    name: 'esdHTKTpaymentInvoice',
    fields: ['payment.id', 'invoice.id', 'deduction.type', 'deduction.amount', 'deduction.rate']
  },
  {
    name: 'esdHTKTpaymentCostDivision',
    fields: ['id', 'payment.id', 'vendor.id', 'account.number', 'account.name',
      'amount', 'currency', 'department',
      'department.name', 'branch', 'description', 'order']
  },
  {
    name: 'esdHTKTpaymentEntry',
    fields: entryFields('payment.id')
  },
  {
    name: 'esdHTKTprepayment',
    fields: ['id', 'department', 'description', 'current.phase', 'created.by',
      'user.checker.kttc', 'initial.role']
  },
  {
    name: 'esdHTKTprepaymentVendor',
    fields: ['prepayment.id', 'vendor.id', 'vendor.site.id', 'amount', 'currency',
      'payment.method', 'beneficiary.account', 'beneficiary.name', 'beneficiary.bank']
  },
  {
    name: 'esdHTKTprepaymentInvoice',
    fields: ['prepayment.id', 'invoice.id', 'deduction.type']
  },
  {
    name: 'esdHTKTprepaymentEntry',
    fields: entryFields('prepayment.id')
  },
  {
    name: 'esdHTKTinvoice',
    fields: ['id', 'total.tax', 'exchange.rate', 'seller.tax.code']
  },
  {
    name: 'esdHDcontract',
    fields: [
      'id', 'name', 'category', 'contact.list', 'contract.group',
      'contract.no', 'contract.type', 'contract.start.date', 'contract.end.date',
      'actual.end.date', 'expected.end.date', 'signed.date', 'signer',
      'contract.value.before.tax', 'tax.amount', 'contract.value.after.tax',
      'total.contract.value', 'total.budget', 'total.executed.value',
      'total.unexecuted.value', 'total.paid.amount', 'total.settlement.amount',
      'remaining.amount', 'duration.unit', 'execution.duration',
      'execution.dependency', 'executor.id', 'current.phase', 'status',
      'is.budgeted', 'item.id', 'item.name', 'kms.id', 'id.activity.vj',
      'id.ncc.vj', 'unit.lv1', 'unit.lv2', 'unit.lv3', 'note',
      'created.at', 'created.by', 'sysmodtime', 'sysmoduser'
    ]
  },
  {
    name: 'esdHTKTvendor',
    fields: ['id', 'vendor.name', 'vendor.number']
  },
  {
    name: 'esdHTKTvendorSite',
    fields: ['id', 'ogl.site.code', 'debit.account', 'credit.account']
  },
  {
    name: 'esdDMcategoryItems',
    fields: ['category.id', 'item.id', 'item.name']
  },
  {
    name: 'esdDMglAccount',
    fields: ['account', 'name', 'account.type', 'apply.currency']
  },
  {
    name: 'contacts',
    fields: ['contact.name', 'lv1.id']
  },
  {
    name: 'esdDMentity',
    fields: ['ps.code', 'entity.code', 'ogl.branch.code', 'org.transaction.code', 'branch.name']
  },
  {
    name: 'esdQTorgUnit',
    fields: ['unit.id', 'unit.name', 'parent.id']
  },
  {
    name: 'esdDMbank',
    fields: ['bank.code', 'name']
  },
  {
    name: 'esdDMcostCenter',
    fields: ['org.code', 'cost.center', 'name', 'status']
  }
];

run();

function run() {
  var result = {
    success: true,
    maxRowsPerTable: MAX_ROWS,
    counts: {},
    tables: {},
    errors: []
  };

  for (var i = 0; i < TABLES.length; i++) {
    var definition = TABLES[i];
    var rows = selectTopRows(definition.name, definition.fields, MAX_ROWS, result.errors);
    result.tables[definition.name] = rows;
    result.counts[definition.name] = rows.length;
  }

  result.contractsWithVendorMultipleInvoices =
    findContractsWithVendorMultipleInvoices(result.tables);

  result.success = result.errors.length === 0;
  var output = JSON.stringify(result);

  /* Xem ket qua trong log JavaScript. */
  try { print(output); } catch (ignorePrint) {}

  /* Neu script duoc goi qua $L.file thi tra them vao queryReturn. */
  try {
    if (vars['$L.file']) vars['$L.file'].queryReturn = output;
  } catch (ignoreOutput) {}

  return result;
}

/**
 * Tim cap contract/vendor co tu 2 hoa don tro len trong tap du lieu da query.
 * Hoa don duoc gan dung NCC qua seller.tax.code = vendor.number.
 */
function findContractsWithVendorMultipleInvoices(tables) {
  var payments = tables.esdHTKTpayment || [];
  var paymentVendors = tables.esdHTKTpaymentVendor || [];
  var paymentInvoices = tables.esdHTKTpaymentInvoice || [];
  var invoices = tables.esdHTKTinvoice || [];
  var vendors = tables.esdHTKTvendor || [];
  var paymentById = {};
  var vendorById = {};
  var invoiceById = {};
  var groups = {};
  var result = [];
  var i;

  for (i = 0; i < payments.length; i++) paymentById[payments[i].id] = payments[i];
  for (i = 0; i < vendors.length; i++) vendorById[vendors[i].id] = vendors[i];
  for (i = 0; i < invoices.length; i++) invoiceById[invoices[i].id] = invoices[i];

  for (i = 0; i < paymentVendors.length; i++) {
    var paymentVendor = paymentVendors[i];
    var payment = paymentById[paymentVendor['payment.id']];
    var vendor = vendorById[paymentVendor['vendor.id']];
    var contractId = payment ? String(payment['contract.id'] || '') : '';
    var vendorNumber = vendor ? String(vendor['vendor.number'] || '') : '';
    if (!contractId || !vendorNumber) continue;

    var key = contractId + '|' + paymentVendor['vendor.id'];
    if (!groups[key]) {
      groups[key] = {
        contract_id: contractId,
        contract_name: String(payment['contract.name'] || ''),
        vendor_id: String(paymentVendor['vendor.id'] || ''),
        vendor_number: vendorNumber,
        vendor_name: String(vendor['vendor.name'] || ''),
        invoice_ids: [],
        invoice_seen: {}
      };
    }

    for (var j = 0; j < paymentInvoices.length; j++) {
      var paymentInvoice = paymentInvoices[j];
      if (paymentInvoice['payment.id'] !== paymentVendor['payment.id']) continue;
      var invoice = invoiceById[paymentInvoice['invoice.id']];
      if (!invoice || String(invoice['seller.tax.code'] || '') !== vendorNumber) continue;
      var invoiceId = String(paymentInvoice['invoice.id'] || '');
      if (invoiceId && !groups[key].invoice_seen[invoiceId]) {
        groups[key].invoice_seen[invoiceId] = true;
        groups[key].invoice_ids.push(invoiceId);
      }
    }
  }

  for (var groupKey in groups) {
    if (!groups.hasOwnProperty(groupKey)) continue;
    var group = groups[groupKey];
    if (group.invoice_ids.length < 2) continue;
    delete group.invoice_seen;
    group.invoice_count = group.invoice_ids.length;
    result.push(group);
  }

  return result;
}

function selectTopRows(tableName, fields, maxRows, errors) {
  var rows = [];
  var file = null;
  var rc;

  try {
    file = new SCFile(tableName, SCFILE_READONLY);
    rc = file.doSelect('true');

    while (rc === RC_SUCCESS && rows.length < maxRows) {
      var row = {};
      for (var i = 0; i < fields.length; i++) {
        row[fields[i]] = readField(file, fields[i]);
      }
      rows.push(row);
      rc = file.getNext();
    }
  } catch (e) {
    errors.push({ table: tableName, error: e.toString() });
  }

  closeFile(file);
  return rows;
}

function entryFields(parentField) {
  return [
    'id', parentField, 'entry.type', 'ledger.type', 'account.type',
    'account.number', 'account.name', 'branch', 'department', 'transaction.code',
    'amount', 'currency', 'description', 'vendor.id', 'type', 'order',
    'accounting.request.id'
  ];
}

function readField(record, fieldName) {
  try {
    var value = record[fieldName];
    return value === null || value === undefined ? '' : value;
  } catch (e) {
    return '';
  }
}

function closeFile(file) {
  try { if (file) file.close(); } catch (ignore) {}
}
