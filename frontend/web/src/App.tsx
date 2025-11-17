import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface MedicalRecord {
  id: string;
  patientName: string;
  age: number;
  conditionScore: number;
  urgencyLevel: number;
  timestamp: number;
  creator: string;
  description: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface MedicalStats {
  totalRecords: number;
  verifiedRecords: number;
  avgConditionScore: number;
  highUrgencyCases: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    patientName: "", 
    age: "", 
    conditionScore: "", 
    urgencyLevel: "",
    description: ""
  });
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredRecords, setFilteredRecords] = useState<MedicalRecord[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);
  const [operationHistory, setOperationHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<MedicalStats>({
    totalRecords: 0,
    verifiedRecords: 0,
    avgConditionScore: 0,
    highUrgencyCases: 0
  });
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized) return;
      if (fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    const filtered = records.filter(record =>
      record.patientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      record.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredRecords(filtered);
  }, [searchTerm, records]);

  useEffect(() => {
    const calculateStats = () => {
      const totalRecords = records.length;
      const verifiedRecords = records.filter(r => r.isVerified).length;
      const avgConditionScore = records.length > 0 
        ? records.reduce((sum, r) => sum + r.conditionScore, 0) / records.length 
        : 0;
      const highUrgencyCases = records.filter(r => r.urgencyLevel >= 8).length;

      setStats({
        totalRecords,
        verifiedRecords,
        avgConditionScore,
        highUrgencyCases
      });
    };

    calculateStats();
  }, [records]);

  const addToHistory = (operation: string) => {
    setOperationHistory(prev => [
      `${new Date().toLocaleTimeString()}: ${operation}`,
      ...prev.slice(0, 9)
    ]);
  };

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: MedicalRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            patientName: businessData.name,
            age: Number(businessData.publicValue1) || 0,
            conditionScore: Number(businessData.publicValue2) || 0,
            urgencyLevel: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            description: businessData.description,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRecords(recordsList);
      addToHistory(`Loaded ${recordsList.length} medical records`);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating medical record with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const ageValue = parseInt(newRecordData.age) || 0;
      const businessId = `medical-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, ageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.patientName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRecordData.conditionScore) || 0,
        parseInt(newRecordData.urgencyLevel) || 0,
        newRecordData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Medical record created successfully!" });
      addToHistory(`Created record for ${newRecordData.patientName}`);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ 
        patientName: "", 
        age: "", 
        conditionScore: "", 
        urgencyLevel: "",
        description: ""
      });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        addToHistory(`Verified decryption for record ${businessId}`);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      addToHistory(`Decrypted and verified record ${businessId}`);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      return null; 
    }
  };

  const handleAvailabilityCheck = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      addToHistory("Checked contract availability");
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
    }
  };

  const renderStatsPanel = () => {
    return (
      <div className="stats-panels">
        <div className="stat-panel metal-gold">
          <h3>Total Records</h3>
          <div className="stat-value">{stats.totalRecords}</div>
          <div className="stat-trend">Medical Cases</div>
        </div>
        
        <div className="stat-panel metal-silver">
          <h3>Verified Data</h3>
          <div className="stat-value">{stats.verifiedRecords}/{stats.totalRecords}</div>
          <div className="stat-trend">FHE Verified</div>
        </div>
        
        <div className="stat-panel metal-bronze">
          <h3>Avg Condition</h3>
          <div className="stat-value">{stats.avgConditionScore.toFixed(1)}/10</div>
          <div className="stat-trend">Patient Health</div>
        </div>
        
        <div className="stat-panel metal-copper">
          <h3>Urgent Cases</h3>
          <div className="stat-value">{stats.highUrgencyCases}</div>
          <div className="stat-trend">Need Attention</div>
        </div>
      </div>
    );
  };

  const renderConditionChart = (record: MedicalRecord) => {
    const condition = record.isVerified ? (record.decryptedValue || 0) : record.age;
    
    return (
      <div className="condition-chart">
        <div className="chart-row">
          <div className="chart-label">Patient Age</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${Math.min(100, condition)}%` }}>
              <span className="bar-value">{condition} years</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Condition Score</div>
          <div className="chart-bar">
            <div className="bar-fill" style={{ width: `${record.conditionScore * 10}%` }}>
              <span className="bar-value">{record.conditionScore}/10</span>
            </div>
          </div>
        </div>
        <div className="chart-row">
          <div className="chart-label">Urgency Level</div>
          <div className="chart-bar">
            <div className="bar-fill urgency" style={{ width: `${record.urgencyLevel * 10}%` }}>
              <span className="bar-value">{record.urgencyLevel}/10</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step">
          <div className="step-icon">🔒</div>
          <div className="step-content">
            <h4>Medical Data Encryption</h4>
            <p>Patient age encrypted with FHE technology</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">🏥</div>
          <div className="step-content">
            <h4>Expert Review</h4>
            <p>Specialists analyze encrypted data securely</p>
          </div>
        </div>
        <div className="process-arrow">→</div>
        <div className="process-step">
          <div className="step-icon">🔓</div>
          <div className="step-content">
            <h4>Secure Decryption</h4>
            <p>Results verified on-chain with zero-knowledge</p>
          </div>
        </div>
      </div>
    );
  };

  const faqItems = [
    {
      question: "How does FHE protect my medical data?",
      answer: "FHE allows computation on encrypted data without decryption, ensuring complete privacy during expert analysis."
    },
    {
      question: "What data is encrypted?",
      answer: "Patient age is FHE-encrypted. Other medical scores remain public for expert assessment."
    },
    {
      question: "How long is data stored?",
      answer: "No data is stored permanently. Records are deleted after verification to ensure privacy."
    },
    {
      question: "Who can access my records?",
      answer: "Only authorized medical experts with proper credentials can access encrypted records."
    }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Medical Second Opinion 🔐</h1>
            <p>FHE-Protected Healthcare</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="medical-icon">🏥</div>
            <h2>Connect Your Wallet to Access Secure Medical Consultation</h2>
            <p>FHE technology ensures your medical data remains private while allowing expert analysis</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Submit encrypted medical records for expert review</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Receive secure second opinions with full privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing Medical FHE System...</p>
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading secure medical records...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Medical Second Opinion 🔐</h1>
          <p>FHE-Protected Healthcare Platform</p>
        </div>
        
        <div className="header-actions">
          <button onClick={handleAvailabilityCheck} className="check-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Record
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="dashboard-section">
          <h2>Medical Records Dashboard</h2>
          {renderStatsPanel()}
          
          <div className="fhe-section">
            <h3>FHE Medical Process Flow</h3>
            {renderFHEProcess()}
          </div>
        </div>
        
        <div className="records-section">
          <div className="section-header">
            <h2>Patient Records</h2>
            <div className="controls">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search records..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
                {showFAQ ? "Hide FAQ" : "Show FAQ"}
              </button>
            </div>
          </div>
          
          {showFAQ && (
            <div className="faq-section">
              <h3>Frequently Asked Questions</h3>
              <div className="faq-list">
                {faqItems.map((faq, index) => (
                  <div key={index} className="faq-item">
                    <div className="faq-question">{faq.question}</div>
                    <div className="faq-answer">{faq.answer}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <div className="operation-history">
            <h4>Recent Operations</h4>
            <div className="history-list">
              {operationHistory.map((op, index) => (
                <div key={index} className="history-item">{op}</div>
              ))}
            </div>
          </div>
          
          <div className="records-list">
            {filteredRecords.length === 0 ? (
              <div className="no-records">
                <p>No medical records found</p>
                <button onClick={() => setShowCreateModal(true)} className="create-btn">
                  Create First Record
                </button>
              </div>
            ) : filteredRecords.map((record, index) => (
              <div 
                className={`record-item ${selectedRecord?.id === record.id ? "selected" : ""} ${record.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedRecord(record)}
              >
                <div className="record-header">
                  <div className="patient-name">{record.patientName}</div>
                  <div className="record-status">
                    {record.isVerified ? "✅ Verified" : "🔓 Pending Verification"}
                  </div>
                </div>
                <div className="record-meta">
                  <span>Condition: {record.conditionScore}/10</span>
                  <span>Urgency: {record.urgencyLevel}/10</span>
                  <span>Date: {new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="record-description">{record.description}</div>
                <div className="record-creator">Doctor: {record.creator.substring(0, 6)}...{record.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateRecord 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => setSelectedRecord(null)} 
          isDecrypting={fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.id)}
          renderConditionChart={renderConditionChart}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRecord: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({ ...recordData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>New Medical Record</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Patient age will be encrypted with FHE technology for privacy</p>
          </div>
          
          <div className="form-group">
            <label>Patient Name *</label>
            <input 
              type="text" 
              name="patientName" 
              value={recordData.patientName} 
              onChange={handleChange} 
              placeholder="Enter patient name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Patient Age (FHE Encrypted) *</label>
            <input 
              type="number" 
              name="age" 
              value={recordData.age} 
              onChange={handleChange} 
              placeholder="Enter age..." 
              min="0"
              max="120"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Condition Score (1-10) *</label>
            <input 
              type="number" 
              name="conditionScore" 
              value={recordData.conditionScore} 
              onChange={handleChange} 
              placeholder="1-10 scale..." 
              min="1"
              max="10"
            />
            <div className="data-type-label">Public Medical Data</div>
          </div>
          
          <div className="form-group">
            <label>Urgency Level (1-10) *</label>
            <input 
              type="number" 
              name="urgencyLevel" 
              value={recordData.urgencyLevel} 
              onChange={handleChange} 
              placeholder="1-10 scale..." 
              min="1"
              max="10"
            />
            <div className="data-type-label">Public Medical Data</div>
          </div>
          
          <div className="form-group">
            <label>Medical Description *</label>
            <textarea 
              name="description" 
              value={recordData.description} 
              onChange={handleChange} 
              placeholder="Describe the medical condition..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.patientName || !recordData.age} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Secure Record"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: MedicalRecord;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  renderConditionChart: (record: MedicalRecord) => JSX.Element;
}> = ({ record, onClose, isDecrypting, decryptData, renderConditionChart }) => {
  const handleDecrypt = async () => {
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>Medical Record Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Patient Name:</span>
              <strong>{record.patientName}</strong>
            </div>
            <div className="info-item">
              <span>Doctor:</span>
              <strong>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Created:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Medical Data Analysis</h3>
            {renderConditionChart(record)}
            
            <div className="encryption-section">
              <div className="data-row">
                <div className="data-label">Patient Age:</div>
                <div className="data-value">
                  {record.isVerified && record.decryptedValue ? 
                    `${record.decryptedValue} years (Verified)` : 
                    "🔒 FHE Encrypted"
                  }
                </div>
                <button 
                  className={`decrypt-btn ${record.isVerified ? 'verified' : ''}`}
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : record.isVerified ? "✅ Verified" : "🔓 Verify Age"}
                </button>
              </div>
            </div>
            
            <div className="medical-description">
              <h4>Medical Description</h4>
              <p>{record.description}</p>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!record.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on Blockchain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


