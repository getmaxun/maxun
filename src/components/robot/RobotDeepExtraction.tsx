import React, { useState, useEffect } from 'react';
import { GenericModal } from "../ui/GenericModal";
import { 
    TextField, 
    Typography, 
    Box, 
    Button, 
    Alert, 
    AlertTitle,
    Chip,
    IconButton,
    Divider,
    List,
    ListItem,
    ListItemText,
    ListItemSecondaryAction
} from "@mui/material";
import { 
    CloudUpload, 
    Delete, 
    FileDownload, 
    Info,
    CheckCircle,
    Error as ErrorIcon
} from "@mui/icons-material";
import { modalStyle } from "../recorder/AddWhereCondModal";
import { useGlobalInfoStore } from '../../context/globalInfo';
import { getStoredRecording, getStoredRecordings, deepExtractRecording } from '../../api/storage';
import { WhereWhatPair } from 'maxun-core';
import { useTranslation } from 'react-i18next';

interface RobotMeta {
    name: string;
    id: string;
    prebuiltId?: string;
    createdAt: string;
    pairs: number;
    updatedAt: string;
    params: any[];
    type?: string;
    description?: string;
    usedByUsers?: number[];
    subscriptionLevel?: number;
    access?: string;
    sample?: any[];
    url?: string;
}

interface RobotWorkflow {
    workflow: WhereWhatPair[];
}

interface RobotSettings {
    id: string;
    userId?: number;
    recording_meta: RobotMeta;
    recording: RobotWorkflow;
    google_sheet_email?: string | null;
    google_sheet_name?: string | null;
    google_sheet_id?: string | null;
    google_access_token?: string | null;
    google_refresh_token?: string | null;
}

interface RobotDeepExtractionProps {
    isOpen: boolean;
    handleStart: (settings: any) => void;
    handleClose: () => void;
    initialSettings?: RobotSettings | null;
}

interface ImportedFile {
    name: string;
    type: string;
    size: number;
    urls: string[];
    validUrls: string[];
    invalidUrls: string[];
}

export const RobotDeepExtractionModal = ({ 
    isOpen, 
    handleStart, 
    handleClose, 
    initialSettings 
}: RobotDeepExtractionProps) => {
    const { t } = useTranslation();
    const [robot, setRobot] = useState<RobotSettings | null>(null);
    const [targetUrlPattern, setTargetUrlPattern] = useState<string>('');
    const [importedFile, setImportedFile] = useState<ImportedFile | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const { recordingId, notify } = useGlobalInfoStore();

    useEffect(() => {
        if (isOpen) {
            getRobot();
        }
    }, [isOpen]);

    useEffect(() => {
        if (robot) {
            let url = robot.recording_meta.url;
            
            if (!url) {
                const lastPair = robot?.recording.workflow[robot?.recording.workflow.length - 1];
                url = lastPair?.what.find(action => action.action === "goto")?.args?.[0];
            }
            
            setTargetUrlPattern(url || '');
        }
    }, [robot]);

    const getRobot = async () => {
        if (recordingId) {
            const robot = await getStoredRecording(recordingId);
            setRobot(robot);
        } else {
            notify('error', t('robot_deep_extraction.notifications.robot_not_found'));
        }
    };

    const extractUrlsFromContent = (content: string, fileType: string): string[] => {
        const urls: string[] = [];
        
        try {
            if (fileType === 'json') {
                const jsonData = JSON.parse(content);
                
                // Handle different JSON structures
                if (Array.isArray(jsonData)) {
                    jsonData.forEach(item => {
                        if (typeof item === 'string' && isValidUrl(item)) {
                            urls.push(item);
                        } else if (typeof item === 'object') {
                            Object.values(item).forEach(value => {
                                if (typeof value === 'string' && isValidUrl(value)) {
                                    urls.push(value);
                                }
                            });
                        }
                    });
                } else if (typeof jsonData === 'object') {
                    Object.values(jsonData).forEach(value => {
                        if (typeof value === 'string' && isValidUrl(value)) {
                            urls.push(value);
                        } else if (Array.isArray(value)) {
                            value.forEach(item => {
                                if (typeof item === 'string' && isValidUrl(item)) {
                                    urls.push(item);
                                }
                            });
                        }
                    });
                }
            } else {
                // Handle CSV
                const lines = content.split('\n');
                lines.forEach(line => {
                    const cells = line.split(',').map(cell => cell.trim().replace(/"/g, ''));
                    cells.forEach(cell => {
                        if (isValidUrl(cell)) {
                            urls.push(cell);
                        }
                    });
                });
            }
        } catch (error) {
            console.error('Error parsing file content:', error);
        }
        
        return [...new Set(urls)]; // Remove duplicates
    };

    const isValidUrl = (string: string): boolean => {
        try {
            new URL(string);
            return string.startsWith('http://') || string.startsWith('https://');
        } catch {
            return false;
        }
    };

    const getUrlPattern = (url: string): string => {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.hostname}${urlObj.pathname}`;
        } catch {
            return url;
        }
    };

    const urlsMatchPattern = (urls: string[], pattern: string): { valid: string[], invalid: string[] } => {
        const patternObj = new URL(pattern);
        const patternBase = `${patternObj.protocol}//${patternObj.hostname}`;
        
        const valid: string[] = [];
        const invalid: string[] = [];
        
        urls.forEach(url => {
            try {
                const urlObj = new URL(url);
                const urlBase = `${urlObj.protocol}//${urlObj.hostname}`;
                
                if (urlBase === patternBase) {
                    valid.push(url);
                } else {
                    invalid.push(url);
                }
            } catch {
                invalid.push(url);
            }
        });
        
        return { valid, invalid };
    };

    const handleFileUpload = async (file: File) => {
        if (!file) return;
        
        const allowedTypes = ['text/csv', 'application/json', 'text/json'];
        const fileExtension = file.name.split('.').pop()?.toLowerCase();
        
        if (!allowedTypes.includes(file.type) && !['csv', 'json'].includes(fileExtension || '')) {
            notify('error', t('robot_deep_extraction.notifications.invalid_file_type'));
            return;
        }

        setIsProcessing(true);
        
        try {
            const content = await file.text();
            const fileType = fileExtension === 'json' ? 'json' : 'csv';
            const extractedUrls = extractUrlsFromContent(content, fileType);
            
            if (extractedUrls.length === 0) {
                notify('warning', t('robot_deep_extraction.notifications.no_urls_found'));
                setIsProcessing(false);
                return;
            }

            const { valid, invalid } = urlsMatchPattern(extractedUrls, targetUrlPattern);
            
            const importedFileData: ImportedFile = {
                name: file.name,
                type: fileType,
                size: file.size,
                urls: extractedUrls,
                validUrls: valid,
                invalidUrls: invalid
            };
            
            setImportedFile(importedFileData);
            
            if (valid.length === 0) {
                notify('warning', t('robot_deep_extraction.notifications.no_matching_urls'));
            } else {
                notify('success', t('robot_deep_extraction.notifications.file_processed', { 
                    valid: valid.length, 
                    total: extractedUrls.length 
                }));
            }
        } catch (error) {
            notify('error', t('robot_deep_extraction.notifications.file_processing_error'));
            console.error('Error processing file:', error);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            handleFileUpload(e.dataTransfer.files[0]);
        }
    };

    const handleDrag = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === "dragenter" || e.type === "dragover") {
            setDragActive(true);
        } else if (e.type === "dragleave") {
            setDragActive(false);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            handleFileUpload(e.target.files[0]);
        }
    };

    const removeFile = () => {
        setImportedFile(null);
    };

    const downloadSampleFile = (type: 'csv' | 'json') => {
        let content = '';
        let filename = '';
        let mimeType = '';
        
        if (type === 'csv') {
            content = `url\n${targetUrlPattern}\n${targetUrlPattern.replace(/\/[^\/]*$/, '/example1')}\n${targetUrlPattern.replace(/\/[^\/]*$/, '/example2')}`;
            filename = 'sample_urls.csv';
            mimeType = 'text/csv';
        } else {
            const sampleData = {
                urls: [
                    targetUrlPattern,
                    targetUrlPattern.replace(/\/[^\/]*$/, '/example1'),
                    targetUrlPattern.replace(/\/[^\/]*$/, '/example2')
                ]
            };
            content = JSON.stringify(sampleData, null, 2);
            filename = 'sample_urls.json';
            mimeType = 'application/json';
        }
        
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleStartDeepExtraction = async () => {
        if (!importedFile || importedFile.validUrls.length === 0) {
            notify('error', t('robot_deep_extraction.notifications.no_valid_urls'));
            return;
        }

        try {
            const deepExtractionSettings = {
                robotId: robot?.id,
                robotName: robot?.recording_meta.name,
                targetUrls: importedFile.validUrls,
                totalUrls: importedFile.validUrls.length,
                fileName: importedFile.name
            };

            // Call the deep extract API
            const result = await deepExtractRecording(robot?.recording_meta.id || '', importedFile.validUrls);
            
            if (result) {
                handleStart(deepExtractionSettings);
                handleClose();
                
                notify('success', t('robot_deep_extraction.notifications.extraction_started', {
                    count: importedFile.validUrls.length
                }));
            } else {
                notify('error', t('robot_deep_extraction.notifications.extraction_error'));
            }
        } catch (error) {
            notify('error', t('robot_deep_extraction.notifications.extraction_error'));
            console.error('Error starting deep extraction:', error);
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <GenericModal
            isOpen={isOpen}
            onClose={handleClose}
            modalStyle={{ ...modalStyle, width: '50%', maxHeight: '80vh', overflow: 'auto' }}
        >
            <>
                <Typography variant="h5" style={{ marginBottom: '20px' }}>
                    {t('robot_deep_extraction.title')}
                </Typography>
                
                {robot && (
                    <Box style={{ display: 'flex', flexDirection: 'column' }}>
                        <Alert severity="info" style={{ marginBottom: '20px' }}>
                            <AlertTitle>{t('robot_deep_extraction.info.title')}</AlertTitle>
                            {t('robot_deep_extraction.info.description')}
                        </Alert>

                        <Box style={{ marginBottom: '20px' }}>
                            <Typography variant="h6" gutterBottom>
                                {t('robot_deep_extraction.robot_info.title')}
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                                <strong>{t('robot_deep_extraction.robot_info.name')}:</strong> {robot.recording_meta.name}
                            </Typography>
                            <Typography variant="body2" color="textSecondary">
                                <strong>{t('robot_deep_extraction.robot_info.target_pattern')}:</strong> {targetUrlPattern}
                            </Typography>
                        </Box>

                        <Divider style={{ margin: '20px 0' }} />

                        <Typography variant="h6" gutterBottom>
                            {t('robot_deep_extraction.file_upload.title')}
                        </Typography>
                        
                        <Alert severity="warning" style={{ marginBottom: '15px' }}>
                            {t('robot_deep_extraction.file_upload.guidelines')}
                        </Alert>

                        <Box style={{ marginBottom: '15px' }}>
                            <Typography variant="body2" style={{ marginBottom: '10px' }}>
                                {t('robot_deep_extraction.file_upload.sample_files')}
                            </Typography>
                            <Box display="flex" gap={1}>
                                <Button
                                    size="small"
                                    startIcon={<FileDownload />}
                                    onClick={() => downloadSampleFile('csv')}
                                    variant="outlined"
                                >
                                    {t('robot_deep_extraction.file_upload.download_csv')}
                                </Button>
                                <Button
                                    size="small"
                                    startIcon={<FileDownload />}
                                    onClick={() => downloadSampleFile('json')}
                                    variant="outlined"
                                >
                                    {t('robot_deep_extraction.file_upload.download_json')}
                                </Button>
                            </Box>
                        </Box>

                        {!importedFile ? (
                            <Box
                                onDragEnter={handleDrag}
                                onDragLeave={handleDrag}
                                onDragOver={handleDrag}
                                onDrop={handleDrop}
                                style={{
                                    border: `2px dashed ${dragActive ? '#ff00c3' : '#ccc'}`,
                                    borderRadius: '8px',
                                    padding: '40px',
                                    textAlign: 'center',
                                    backgroundColor: dragActive ? '#f9f9f9' : 'transparent',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    marginBottom: '20px'
                                }}
                                onClick={() => document.getElementById('file-input')?.click()}
                            >
                                <CloudUpload style={{ fontSize: '48px', color: '#ccc', marginBottom: '10px' }} />
                                <Typography variant="body1" style={{ marginBottom: '10px' }}>
                                    {isProcessing 
                                        ? t('robot_deep_extraction.file_upload.processing')
                                        : t('robot_deep_extraction.file_upload.drag_drop')
                                    }
                                </Typography>
                                <Typography variant="body2" color="textSecondary">
                                    {t('robot_deep_extraction.file_upload.supported_formats')}
                                </Typography>
                                <input
                                    id="file-input"
                                    type="file"
                                    accept=".csv,.json"
                                    onChange={handleFileInput}
                                    style={{ display: 'none' }}
                                />
                            </Box>
                        ) : (
                            <Box style={{ marginBottom: '20px' }}>
                                <Alert 
                                    severity={importedFile.validUrls.length > 0 ? "success" : "warning"}
                                    style={{ marginBottom: '15px' }}
                                >
                                    <Box display="flex" justifyContent="space-between" alignItems="center">
                                        <Box>
                                            <Typography variant="body2">
                                                <strong>{importedFile.name}</strong> ({formatFileSize(importedFile.size)})
                                            </Typography>
                                            <Typography variant="caption" display="block">
                                                {t('robot_deep_extraction.file_upload.urls_found', {
                                                    total: importedFile.urls.length,
                                                    valid: importedFile.validUrls.length,
                                                    invalid: importedFile.invalidUrls.length
                                                })}
                                            </Typography>
                                        </Box>
                                        <IconButton onClick={removeFile} size="small" color="error">
                                            <Delete />
                                        </IconButton>
                                    </Box>
                                </Alert>

                                {importedFile.validUrls.length > 0 && (
                                    <Box style={{ marginBottom: '15px' }}>
                                        <Typography variant="subtitle2" style={{ marginBottom: '10px', display: 'flex', alignItems: 'center' }}>
                                            <CheckCircle style={{ color: 'green', marginRight: '5px', fontSize: '16px' }} />
                                            {t('robot_deep_extraction.file_upload.valid_urls')} ({importedFile.validUrls.length})
                                        </Typography>
                                        <Box style={{ maxHeight: '120px', overflow: 'auto', border: '1px solid #e0e0e0', borderRadius: '4px' }}>
                                            <List dense>
                                                {importedFile.validUrls.slice(0, 10).map((url, index) => (
                                                    <ListItem key={index}>
                                                        <ListItemText 
                                                            primary={url}
                                                            primaryTypographyProps={{ variant: 'body2' }}
                                                        />
                                                    </ListItem>
                                                ))}
                                                {importedFile.validUrls.length > 10 && (
                                                    <ListItem>
                                                        <ListItemText 
                                                            primary={t('robot_deep_extraction.file_upload.and_more', {
                                                                count: importedFile.validUrls.length - 10
                                                            })}
                                                            primaryTypographyProps={{ variant: 'body2', style: { fontStyle: 'italic' } }}
                                                        />
                                                    </ListItem>
                                                )}
                                            </List>
                                        </Box>
                                    </Box>
                                )}

                                {importedFile.invalidUrls.length > 0 && (
                                    <Box style={{ marginBottom: '15px' }}>
                                        <Typography variant="subtitle2" style={{ marginBottom: '10px', display: 'flex', alignItems: 'center' }}>
                                            <ErrorIcon style={{ color: 'orange', marginRight: '5px', fontSize: '16px' }} />
                                            {t('robot_deep_extraction.file_upload.invalid_urls')} ({importedFile.invalidUrls.length})
                                        </Typography>
                                        <Alert severity="warning" style={{ padding: '8px' }}>
                                            <Typography variant="caption">
                                                {t('robot_deep_extraction.file_upload.invalid_urls_note')}
                                            </Typography>
                                        </Alert>
                                    </Box>
                                )}
                            </Box>
                        )}

                        <Box mt={3} display="flex" justifyContent="flex-end" gap={1}>
                            <Button
                                onClick={handleClose}
                                color="primary"
                                variant="outlined"
                                sx={{
                                    color: '#ff00c3 !important',
                                    borderColor: '#ff00c3 !important',
                                    backgroundColor: 'whitesmoke !important',
                                }}
                            >
                                {t('robot_deep_extraction.buttons.cancel')}
                            </Button>
                            <Button 
                                variant="contained" 
                                color="primary" 
                                onClick={handleStartDeepExtraction}
                                disabled={!importedFile || importedFile.validUrls.length === 0 || isProcessing}
                            >
                                {t('robot_deep_extraction.buttons.start_extraction')} 
                                {importedFile && importedFile.validUrls.length > 0 && ` (${importedFile.validUrls.length} URLs)`}
                            </Button>
                        </Box>
                    </Box>
                )}
            </>
        </GenericModal>
    );
};