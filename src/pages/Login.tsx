import axios from "axios"; 
import { useState, useContext, useEffect, FormEvent } from "react"; 
import { useNavigate, Link } from "react-router-dom"; 
import { AuthContext } from "../context/auth"; 
import { Box, Typography, TextField, Button, CircularProgress, Grid } from "@mui/material"; 
import { useGlobalInfoStore } from "../context/globalInfo"; 
import { apiUrl } from "../apiConfig";
import { useTranslation } from 'react-i18next';
import i18n from '../i18n'; 

const Login = () => {
   const { t } = useTranslation();
   // just don't remove these logs - god knows why it's not working without them
   console.log(i18n) 
   console.log(t)
   const [form, setForm] = useState({
     email: "",
     password: "",
   });
   const [loading, setLoading] = useState(false);
   const { notify } = useGlobalInfoStore();
   const { email, password } = form;

   const { state, dispatch } = useContext(AuthContext);
   const { user } = state;

   const navigate = useNavigate();

   useEffect(() => {
     if (user) {
       navigate("/");
     }
   }, [user, navigate]);

   const handleChange = (e: any) => {
     const { name, value } = e.target;
     setForm({ ...form, [name]: value });
   };

   const submitForm = async (e: any) => {
     e.preventDefault();
     setLoading(true);
     try {
       const { data } = await axios.post(`${apiUrl}/auth/login`, {
         email,
         password,
       });
       dispatch({ type: "LOGIN", payload: data });
       notify("success", t('login.welcome_notification'));
       window.localStorage.setItem("user", JSON.stringify(data));
       navigate("/");
     } catch (err) {
       notify("error", t('login.error_notification'));
       setLoading(false);
     }
   };

   // Language switcher function
   

   return (
     <Box
       sx={{
         display: "flex",
         justifyContent: "center",
         alignItems: "center",
         maxHeight: "100vh",
         mt: 6,
         padding: 4,
       }}
     >
       {/* Language Switcher Buttons */}

       <Box
         component="form"
         onSubmit={submitForm}
         sx={{
           textAlign: "center",
           backgroundColor: "#ffffff",
           padding: 6,
           borderRadius: 5,
           boxShadow: "0px 20px 40px rgba(0, 0, 0, 0.2), 0px -5px 10px rgba(0, 0, 0, 0.15)",
           display: "flex",
           flexDirection: "column",
           alignItems: "center",
           maxWidth: 400,
           width: "100%",
         }}
       >
         <img src="../src/assets/maxunlogo.png" alt="logo" height={55} width={60} style={{ marginBottom: 20, borderRadius: "20%", alignItems: "center" }} />
         <Typography variant="h4" gutterBottom>
           {t('login.title')}
         </Typography>
         <TextField
           fullWidth
           label={t('login.email')}
           name="email"
           value={email}
           onChange={handleChange}
           margin="normal"
           variant="outlined"
           required
         />
         <TextField
           fullWidth
           label={t('login.password')}
           name="password"
           type="password"
           value={password}
           onChange={handleChange}
           margin="normal"
           variant="outlined"
           required
         />
         <Button
           type="submit"
           fullWidth
           variant="contained"
           color="primary"
           sx={{ mt: 2, mb: 2 }}
           disabled={loading || !email || !password}
         >
           {loading ? (
             <>
               <CircularProgress size={20} sx={{ mr: 2 }} />
               {t('login.loading')}
             </>
           ) : (
             t('login.button')
           )}
         </Button>
         <Typography variant="body2" align="center">
           {t('login.register_prompt')}{" "}
           <Link to="/register" style={{ textDecoration: "none", color: "#ff33cc" }}>
             {t('login.register_link')}
           </Link>
         </Typography>
       </Box>
     </Box>
   );
};

export default Login;