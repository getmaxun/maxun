import { default as axios } from "axios";
import { WorkflowFile } from "maxun-core";
import { RunSettings } from "../components/molecules/RunSettings";
import { ScheduleSettings } from "../components/molecules/ScheduleSettings";
import { CreateRunResponse, ScheduleRunResponse } from "../pages/MainPage";
import { apiUrl } from "../apiConfig";






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

export const updateRecording = async (id: string, data: { name?: string; limit?: number }): Promise<boolean> => {
  try {
    const response = await axios.put(`${apiUrl}/storage/recordings/${id}`, data);
    if (response.status === 200) {
      return true;
    } else {
      throw new Error(`Couldn't update recording with id ${id}`);
    }
  } catch (error: any) {
    console.error(`Error updating recording: ${error.message}`);
    return false;
  }
};

export const duplicateRecording = async (id: string, targetUrl: string): Promise<any> => {
  try {
    const response = await axios.post(`${apiUrl}/storage/recordings/${id}/duplicate`, {
      targetUrl,
    });
    if (response.status === 201) {
      return response.data; // Returns the duplicated robot details
    } else {
      throw new Error(`Couldn't duplicate recording with id ${id}`);
    }
  } catch (error: any) {
    console.error(`Error duplicating recording: ${error.message}`);
    return null;
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
    return { browserId: '', runId: '' };
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

export const notifyAboutAbort = async (id: string): Promise<boolean> => {
  try {
    const response = await axios.post(`${apiUrl}/storage/runs/abort/${id}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Couldn't abort a running recording with id ${id}`);
    }
  } catch (error: any) {
    console.log(error);
    return false;
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