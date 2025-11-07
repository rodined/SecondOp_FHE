pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecondOp_FHE is ZamaEthereumConfig {
    
    struct MedicalCase {
        string patientId;                    
        euint32 encryptedDiagnosis;        
        uint256 caseId;          
        string medicalHistory;          
        address specialist;               
        uint256 timestamp;             
        uint32 decryptedDiagnosis; 
        bool isVerified; 
    }
    

    mapping(string => MedicalCase) public medicalCases;
    
    string[] public caseIds;
    
    event MedicalCaseCreated(string indexed caseId, address indexed specialist);
    event DiagnosisVerified(string indexed caseId, uint32 decryptedDiagnosis);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createMedicalCase(
        string calldata caseId,
        string calldata patientId,
        externalEuint32 encryptedDiagnosis,
        bytes calldata inputProof,
        uint256 caseIdentifier,
        string calldata medicalHistory
    ) external {
        require(bytes(medicalCases[caseId].patientId).length == 0, "Medical case already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedDiagnosis, inputProof)), "Invalid encrypted diagnosis");
        
        medicalCases[caseId] = MedicalCase({
            patientId: patientId,
            encryptedDiagnosis: FHE.fromExternal(encryptedDiagnosis, inputProof),
            caseId: caseIdentifier,
            medicalHistory: medicalHistory,
            specialist: msg.sender,
            timestamp: block.timestamp,
            decryptedDiagnosis: 0,
            isVerified: false
        });
        
        FHE.allowThis(medicalCases[caseId].encryptedDiagnosis);
        
        FHE.makePubliclyDecryptable(medicalCases[caseId].encryptedDiagnosis);
        
        caseIds.push(caseId);
        
        emit MedicalCaseCreated(caseId, msg.sender);
    }
    
    function verifyDiagnosis(
        string calldata caseId, 
        bytes memory abiEncodedClearDiagnosis,
        bytes memory decryptionProof
    ) external {
        require(bytes(medicalCases[caseId].patientId).length > 0, "Medical case does not exist");
        require(!medicalCases[caseId].isVerified, "Diagnosis already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(medicalCases[caseId].encryptedDiagnosis);
        
        FHE.checkSignatures(cts, abiEncodedClearDiagnosis, decryptionProof);
        
        uint32 decodedDiagnosis = abi.decode(abiEncodedClearDiagnosis, (uint32));
        
        medicalCases[caseId].decryptedDiagnosis = decodedDiagnosis;
        medicalCases[caseId].isVerified = true;
        
        emit DiagnosisVerified(caseId, decodedDiagnosis);
    }
    
    function getEncryptedDiagnosis(string calldata caseId) external view returns (euint32) {
        require(bytes(medicalCases[caseId].patientId).length > 0, "Medical case does not exist");
        return medicalCases[caseId].encryptedDiagnosis;
    }
    
    function getMedicalCase(string calldata caseId) external view returns (
        string memory patientId,
        uint256 caseIdentifier,
        string memory medicalHistory,
        address specialist,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedDiagnosis
    ) {
        require(bytes(medicalCases[caseId].patientId).length > 0, "Medical case does not exist");
        MedicalCase storage data = medicalCases[caseId];
        
        return (
            data.patientId,
            data.caseId,
            data.medicalHistory,
            data.specialist,
            data.timestamp,
            data.isVerified,
            data.decryptedDiagnosis
        );
    }
    
    function getAllCaseIds() external view returns (string[] memory) {
        return caseIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


