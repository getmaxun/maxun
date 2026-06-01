import { default as axios } from "axios";
import { WorkflowFile } from "maxun-core";
import { RunSettings } from "../components/run/RunSettings";
import { ScheduleSettings } from "../components/robot/pages/ScheduleSettingsPage";
import { CreateRunResponse, ScheduleRunResponse } from "../pages/MainPage";
import { apiUrl } from "../apiConfig";
import { OutputFormats } from "../constants/outputFormats";

interface CredentialInfo {
  value: string;
  type: string;
}

interface Credentials {
  [key: string]: CredentialInfo;
}

export const getStoredRecordings = async (): Promise<string[] | null> => {
  try {
    const response = await axios.get(`${apiUrl}/storage/recordings`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Couldn\'t retrieve stored recordings');
    }
  } catch (error: any) {
    console.log(error);
    return null;
  }
};

export const createScrapeRobot = async (
  url: string,
  name?: string,
  formats: string[] = ['markdown'],
  promptInstructions?: string,
  promptLlmProvider?: 'anthropic' | 'openai' | 'ollama',
  promptLlmModel?: string,
  promptLlmApiKey?: string,
  promptLlmBaseUrl?: string
): Promise<any> => {
  try {
    const response = await axios.post(
      `${apiUrl}/storage/recordings/scrape`,
      {
        url,
        name,
        formats,
        ...(promptInstructions ? { promptInstructions } : {}),
        ...(promptLlmProvider ? { promptLlmProvider } : {}),
        ...(promptLlmModel ? { promptLlmModel } : {}),
        ...(promptLlmApiKey ? { promptLlmApiKey } : {}),
        ...(promptLlmBaseUrl ? { promptLlmBaseUrl } : {}),
      },
      {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      }
    );

    if (response.status === 201) {
      return response.data;
    } else {
      throw new Error('Failed to create markdown robot');
    }
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error('Error creating markdown robot:', error);
    return null;
  }
};

export const createLLMRobot = async (
  url: string | undefined,
  prompt: string,
  llmProvider?: 'anthropic' | 'openai' | 'ollama',
  llmModel?: string,
  llmApiKey?: string,
  llmBaseUrl?: string,
  robotName?: string
): Promise<any> => {
  try {
    const response = await axios.post(
      `${apiUrl}/storage/recordings/llm`,
      {
        url: url || undefined,
        prompt,
        llmProvider,
        llmModel,
        llmApiKey,
        llmBaseUrl,
        robotName,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
        timeout: 300000,
      }
    );

    if (response.status === 201) {
      return response.data;
    } else {
      throw new Error('Failed to create LLM robot');
    }
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error('Error creating LLM robot:', error);
    return null;
  }
};

export const updateRecording = async (id: string, data: { 
  name?: string; 
  limits?: Array<{pairIndex: number, actionIndex: number, argIndex: number, limit: number}>;
  credentials?: Credentials; 
  targetUrl?: string;
  workflow?: any[];
  formats?: OutputFormats[];
}): Promise<boolean> => {
  try {
    const response = await axios.put(`${apiUrl}/storage/recordings/${id}`, data);
    if (response.status === 200) {
      return true;
    } else {
      throw new Error(`Couldn't update recording with id ${id}`);
    }
  } catch (error: any) {
    const message = error.response?.data?.error;
    const status = error.response?.status;
    if (message) {
      const err = new Error(message) as any;
      err.isDuplicate = status === 409;
      throw err;
    }
    console.error(`Error updating recording: ${error.message}`);
    return false;
  }
};

export const getStoredRuns = async (): Promise<string[] | null> => {
  try {
    const response = await axios.get(`${apiUrl}/storage/runs`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Couldn\'t retrieve stored recordings');
    }
  } catch (error: any) {
    console.log(error);
    return null;
  }
};

export const getStoredRun = async (id: string): Promise<any | null> => {
  try {
    const response = await axios.get(`${apiUrl}/storage/runs/run/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't retrieve stored run ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return null;
  }
};

export const duplicateRecording = async (id: string, targetUrl: string, newName?: string): Promise<any> => {
  try {
    const response = await axios.post(`${apiUrl}/storage/recordings/${id}/duplicate`, {
      targetUrl,
      newName,
    }, { withCredentials: true });
    if (response.status === 201) {
      return response.data;
    } else {
      throw new Error(`Couldn't duplicate recording with id ${id}`);
    }
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error(`Error duplicating recording: ${error.message}`);
    return null;
  }
};

export const getStoredRecording = async (id: string) => {
  try {
    const response = await axios.get(`${apiUrl}/storage/recordings/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't retrieve stored recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return null;
  }
}

export const checkRunsForRecording = async (id: string): Promise<boolean> => {
  try {
    const response = await axios.get(`${apiUrl}/storage/recordings/${id}/runs`);

    const runs = response.data;
    console.log(runs.runs.totalCount)
    return runs.runs.totalCount > 0;
  } catch (error) {
    console.error('Error checking runs for recording:', error);
    return false;
  }
};

export const deleteRecordingFromStorage = async (id: string): Promise<boolean> => {
  const hasRuns = await checkRunsForRecording(id);

  if (hasRuns) {

    return false;
  }
  try {
    const response = await axios.delete(`${apiUrl}/storage/recordings/${id}`);
    if (response.status === 200) {

      return true;
    } else {
      throw new Error(`Couldn't delete stored recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);

    return false;
  }
};

export const deleteRunFromStorage = async (id: string): Promise<boolean> => {
  try {
    const response = await axios.delete(`${apiUrl}/storage/runs/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't delete stored recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return false;
  }
};

export const editRecordingFromStorage = async (browserId: string, id: string): Promise<WorkflowFile | null> => {
  try {
    const response = await axios.put(`${apiUrl}/workflow/${browserId}/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't edit stored recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return null;
  }
};

export interface CreateRunResponseWithQueue extends CreateRunResponse {
  queued?: boolean;
}

export const createAndRunRecording = async (id: string, settings: RunSettings): Promise<CreateRunResponseWithQueue> => {
  try {
    const response = await axios.put(
      `${apiUrl}/storage/runs/${id}`,
      { ...settings, withCredentials: true }
    );
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't create and run recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return { browserId: '', runId: '', robotMetaId: '', queued: false };
  }
}

export const createRunForStoredRecording = async (id: string, settings: RunSettings): Promise<CreateRunResponse> => {
  try {
    const response = await axios.put(
      `${apiUrl}/storage/runs/${id}`,
      { ...settings });
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't create a run for a recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return { browserId: '', runId: '', robotMetaId: '' };
  }
}

export const interpretStoredRecording = async (id: string): Promise<boolean> => {
  try {
    const response = await axios.post(`${apiUrl}/storage/runs/run/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't run a recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return false;
  }
}

export const notifyAboutAbort = async (id: string): Promise<{ success: boolean; isQueued?: boolean }> => {
  try {
    const response = await axios.post(`${apiUrl}/storage/runs/abort/${id}`, { withCredentials: true });
    if (response.status === 200) {
      return {
        success: response.data.success,
        isQueued: response.data.isQueued
      };
    } else {
      throw new Error(`Couldn't abort a running recording with id ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return { success: false };
  }
}


export const scheduleStoredRecording = async (id: string, settings: ScheduleSettings): Promise<ScheduleRunResponse> => {
  try {
    const response = await axios.put(
      `${apiUrl}/storage/schedule/${id}`,
      { ...settings });
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't schedule recording ${id}. Please try again later.`);
    }
  } catch (error: any) {
    console.log(error);
    return { message: '', runId: '' };
  }
}

export const getSchedule = async (id: string) => {
  try {
    const response = await axios.get(`${apiUrl}/storage/schedule/${id}`);
    if (response.status === 200) {
      return response.data.schedule;
    } else {
      throw new Error(`Couldn't retrieve schedule for recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return null;
  }
}

export const deleteSchedule = async (id: string): Promise<boolean> => {
  try {
    const response = await axios.delete(`${apiUrl}/storage/schedule/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't delete schedule for recording ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return false;
  }
}

export const createCrawlRobot = async (
  url: string,
  name: string,
  crawlConfig: {
    mode: 'domain' | 'subdomain' | 'path';
    limit: number;
    maxDepth: number;
    includePaths: string[];
    excludePaths: string[];
    useSitemap: boolean;
    followLinks: boolean;
    respectRobots: boolean;
  },
  formats: string[] = ['markdown']
): Promise<any> => {
  try {
    const response = await axios.post(
      `${apiUrl}/storage/recordings/crawl`,
      {
        url,
        name,
        crawlConfig,
        formats,
      },
      {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      }
    );

    if (response.status === 201) {
      return response.data;
    } else {
      throw new Error('Failed to create crawl robot');
    }
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error('Error creating crawl robot:', error);
    return null;
  }
};

export const createDocumentExtractRobot = async (
  file: File,
  prompt: string,
  robotName?: string,
  llmProvider?: 'anthropic' | 'openai' | 'ollama',
  llmModel?: string,
  llmApiKey?: string,
  llmBaseUrl?: string
): Promise<any> => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('prompt', prompt);
    if (robotName) formData.append('name', robotName);
    if (llmProvider) formData.append('llmProvider', llmProvider);
    if (llmModel) formData.append('llmModel', llmModel);
    if (llmApiKey) formData.append('llmApiKey', llmApiKey);
    if (llmBaseUrl) formData.append('llmBaseUrl', llmBaseUrl);

    const response = await axios.post(
      `${apiUrl}/storage/recordings/document`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        withCredentials: true,
        timeout: 120000,
      }
    );
    if (response.status === 201) return response.data;
    throw new Error('Failed to create document extraction robot');
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error('Error creating document extraction robot:', error);
    return null;
  }
};

export const createDocumentParseRobot = async (
  file: File,
  robotName: string,
  outputFormats: string[]
): Promise<any> => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('name', robotName);
    outputFormats.forEach((fmt) => formData.append('formats', fmt));

    const response = await axios.post(
      `${apiUrl}/storage/recordings/document-parse`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        withCredentials: true,
        timeout: 120000,
      }
    );
    if (response.status === 201) return response.data;
    throw new Error('Failed to create document parse robot');
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error('Error creating document parse robot:', error);
    return null;
  }
};

export interface DocumentRunResponse {
  runId: string;
  robotMetaId: string;
  status: string;
  error?: string;
}

export const runDocumentRobot = async (
  robotMetaId: string
): Promise<DocumentRunResponse | null> => {
  try {
    const response = await axios.post(
      `${apiUrl}/storage/runs/document-run/${robotMetaId}`,
      {},
      { withCredentials: true }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error running document robot:', error);
    return null;
  }
};

export const runDocumentParseRobot = async (
  robotMetaId: string
): Promise<DocumentRunResponse | null> => {
  try {
    const response = await axios.post(
      `${apiUrl}/storage/runs/document-parse-run/${robotMetaId}`,
      {},
      { withCredentials: true }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error running document parse robot:', error);
    return null;
  }
};

export const replaceDocumentFile = async (
  robotMetaId: string,
  file: File
): Promise<{ message?: string; documentFileName?: string; error?: string } | null> => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    const response = await axios.put(
      `${apiUrl}/storage/recordings/${robotMetaId}/document`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        withCredentials: true,
        timeout: 60000,
      }
    );
    return response.data;
  } catch (error: any) {
    console.error('Error replacing document:', error);
    return { error: error.response?.data?.error || 'Failed to replace document' };
  }
};

export const createSearchRobot = async (
  name: string,
  searchConfig: {
    query: string;
    limit: number;
    provider: 'google' | 'bing' | 'duckduckgo';
    filters?: {
      timeRange?: 'day' | 'week' | 'month' | 'year';
      location?: string;
      lang?: string;
    };
    mode: 'discover' | 'scrape';
  },
  formats?: OutputFormats[]
): Promise<any> => {
  try {
    const response = await axios.post(
      `${apiUrl}/storage/recordings/search`,
      {
        name,
        searchConfig,
        formats: formats || [],
      },
      {
        headers: { 'Content-Type': 'application/json' },
        withCredentials: true,
      }
    );

    if (response.status === 201) {
      return response.data;
    } else {
      throw new Error('Failed to create search robot');
    }
  } catch (error: any) {
    const message = error.response?.data?.error;
    if (message) throw new Error(message);
    console.error('Error creating search robot:', error);
    return null;
  }
};
