import { WhereWhatPair, WorkflowFile } from "maxun-core";
import { emptyWorkflow } from "../shared/constants";
import { default as axios, AxiosResponse } from "axios";
import { apiUrl } from "../apiConfig";

export const getActiveWorkflow = async(id: string) : Promise<WorkflowFile> => {
  try {
    const response = await axios.get(`${apiUrl}/workflow/${id}`)
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Something went wrong when fetching a recorded workflow');
    }
  } catch(error: any) {
    console.log(error);
    return emptyWorkflow;
  }
};

export const getParamsOfActiveWorkflow = async(id: string) : Promise<string[]|null> => {
  try {
    const response = await axios.get(`${apiUrl}/workflow/params/${id}`)
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Something went wrong when fetching the parameters of the recorded workflow');
    }
  } catch(error: any) {
    console.log(error);
    return null;
  }
};

export const deletePair = async(index: number): Promise<WorkflowFile> => {
  try {
   const response = await axios.delete(`${apiUrl}/workflow/pair/${index}`);
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Something went wrong when fetching an updated workflow');
    }
  } catch (error: any) {
    console.log(error);
    return emptyWorkflow;
  }
};

export const AddPair = async(index: number, pair: WhereWhatPair): Promise<WorkflowFile> => {
  try {
    const response = await axios.post(`${apiUrl}/workflow/pair/${index}`, {
      pair,
    }, {headers: {'Content-Type': 'application/json'}});
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Something went wrong when fetching an updated workflow');
    }
  } catch (error: any) {
    console.log(error);
    return emptyWorkflow;
  }
};

export const UpdatePair = async(index: number, pair: WhereWhatPair): Promise<WorkflowFile> => {
  try {
    const response = await axios.put(`${apiUrl}/workflow/pair/${index}`, {
      pair,
    }, {headers: {'Content-Type': 'application/json'}});
    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error('Something went wrong when fetching an updated workflow');
    }
  } catch (error: any) {
    console.log(error);
    return emptyWorkflow;
  }
};
